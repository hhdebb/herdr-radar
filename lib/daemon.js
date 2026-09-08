'use strict';

// The resident daemon: one process that owns the sidebar for as long as
// Herdr runs.
//
// A read-only event subscription (lib/subscribe.js) wakes it, a next-deadline
// scheduler sleeps it, and an idle daemon blocked on a pipe costs nothing but
// memory. Events are WAKE HINTS only — every frame's truth is a fresh
// agent-list snapshot (lib/frame.js), which makes replayed, throttled, or
// missed events all equally harmless.
//
// Published tokens are the durable record (a held "done" badge survives the
// daemon), because the daemon can die — and when it does, the watchdog hook
// or the next startup brings a fresh one that reads the tokens back.

const fs = require('node:fs');
const path = require('node:path');

const herdr = require('./herdr');
const config = require('./config');
const state = require('./state');
const view = require('./view');
const logos = require('./logos');
const managed = require('./managed-config');
const subscribe = require('./subscribe');
const control = require('./control');
const tabline = require('./tabline');
const { Frame } = require('./frame');
const { detachedNode } = require('./spawn');
const { stateRoot, ensureDir, herdrConfigPath } = require('./paths');

// A frame may not follow the previous one closer than this: our own token
// writes echo back as pane.updated events, and without a floor the echo of
// frame N schedules frame N+1 early, forever.
const FRAME_FLOOR_MS = 120;
const POLL_MS = 150;
const WAKE_DEBOUNCE_MS = 50;
const TABLINE_MS = 2000;
// How long a title change can sit unnoticed. See the heartbeat below.
const HEARTBEAT_MS = 2000;
const APPEARANCE_MS = 60000;

const ERR_FILE = () => path.join(ensureDir(stateRoot), 'animator.err');

// A resident process must not die silently. The file is truncated at start
// and capped here, so a crash loop cannot fill a disk.
function logError(error) {
  try {
    try {
      if (fs.statSync(ERR_FILE()).size > 256 * 1024) fs.truncateSync(ERR_FILE(), 0);
    } catch {
      // No log yet.
    }
    fs.appendFileSync(ERR_FILE(), `${new Date().toISOString()} ${error?.stack ?? error}\n`, 'utf8');
  } catch {
    // Logging must never take the daemon down.
  }
}

// Run as the daemon. Resolves without doing anything when another daemon
// already owns the control endpoint.
async function start() {
  const src = herdr.source();

  // Log, then exit non-zero so the stderr file and the exit code both say
  // something happened. The watchdog hook or the next startup brings a
  // replacement.
  process.on('uncaughtException', (error) => {
    logError(error);
    process.exit(1);
  });
  process.on('unhandledRejection', (error) => {
    logError(error);
    process.exit(1);
  });

  const frame = new Frame(src);

  /* ---------------------------------------------------------- scheduler */

  // One timer, aimed at the earliest thing that needs doing. Wakes (events,
  // file changes) pull it closer; a finished tick pushes it to the next real
  // deadline.
  let timer = null;
  let nextAt = Infinity;
  let running = false;
  let rerun = false;
  let lastTickAt = 0;
  // Set by the pipe stop handler: no frame may start once a stop is under way.
  let stopping = false;

  let subscription = null;
  const watchers = [];
  const timers = [];
  let ctl = null;

  const shutdown = (code = 0) => {
    frame.flush();
    subscription?.stop();
    for (const interval of timers) clearInterval(interval);
    for (const watcher of watchers) {
      try {
        watcher.close();
      } catch {
        // Already gone.
      }
    }
    try {
      ctl?.close();
    } catch {
      // Already gone.
    }
    try {
      fs.rmSync(state.LOCK(), { force: true });
      // Consume a stop marker on the way out, whatever triggered the exit. A
      // marker nobody consumed reads as "stop pending" to the next start.
      fs.rmSync(state.STOP(), { force: true });
    } catch {
      // Already gone.
    }
    process.exit(code);
  };

  const schedule = (at) => {
    if (timer && at >= nextAt) return;
    if (timer) clearTimeout(timer);
    nextAt = at;
    timer = setTimeout(run, Math.max(0, at - Date.now()));
  };
  const wake = () => schedule(Date.now() + WAKE_DEBOUNCE_MS);

  const run = async () => {
    timer = null;
    nextAt = Infinity;
    if (running) {
      rerun = true;
      return;
    }
    if (Date.now() - lastTickAt < FRAME_FLOOR_MS) {
      schedule(lastTickAt + POLL_MS);
      return;
    }
    running = true;
    try {
      await tick();
    } catch (error) {
      logError(error);
      schedule(Date.now() + 5000);
    } finally {
      running = false;
      if (rerun) {
        rerun = false;
        wake();
      }
    }
  };

  const tick = async () => {
    if (stopping) return;
    const now = Date.now();
    lastTickAt = now;

    if (fs.existsSync(state.STOP())) return shutdown();
    // The bind is the lock, but if something rewrote the pid file to another
    // live process, believe it — two daemons writing is worse than one exit.
    try {
      const owner = Number(fs.readFileSync(state.LOCK(), 'utf8').trim());
      if (owner && owner !== process.pid && state.pidAlive(owner)) return shutdown();
      if (owner !== process.pid) fs.writeFileSync(state.LOCK(), String(process.pid), 'utf8');
    } catch {
      try {
        fs.writeFileSync(state.LOCK(), String(process.pid), 'utf8');
      } catch {
        // Diagnostics only.
      }
    }

    const sleepUntil = await frame.render(now);
    // A failed snapshot: skip the frame and retry soon.
    schedule(sleepUntil ?? now + 1000);
  };

  /* ------------------------------------------------------ control pipe */

  // Binding the control endpoint IS the instance lock: atomic, and on Windows
  // it vanishes with its owner. The pid file is diagnostics, not a lock.
  const handlers = {
    ping: () => ({ pid: process.pid, uptime_ms: Math.round(process.uptime() * 1000) }),
    // View switching in the warm process: the thin client (bin/agent-view.js)
    // sends an op, the daemon applies the override, persists the choice, and
    // repaints on its very next wake — no node startup on the hot path.
    view: async (message) => {
      const current = view.mode();
      const next = view.resolve(current, message);
      // Only the native toggle owns both layers; flip and cycle stay inside the
      // plugin's look and never rewrite config.toml. Rows go first so the
      // socket call below is the last word — see lib/view.js setRows.
      if (message.op === 'native') view.setRows(Boolean(next));
      const reply = next ? await view.apply(next) : await view.clear();
      if (!reply || reply.error) return { mode: current, applied: false };
      view.setMode(next);
      wake();
      return { mode: next, applied: true };
    },
    stop: async () => {
      // Halt the loop FIRST and wait out any in-flight tick: clearing while a
      // frame is mid-write loses the race — the frame repaints a working pane
      // right over the clear.
      stopping = true;
      while (running) await new Promise((resolve) => setTimeout(resolve, 25));
      await state.clearAll(src);
      // Exit once the reply has left the building.
      setTimeout(() => shutdown(), 50);
      return { stopped: true };
    },
  };
  ctl = await control.serve(handlers);
  // A daemon that was just told to stop may still hold the endpoint for a
  // moment after its reply; a restart (settings popup, `state-stop` then
  // `state-start`) must not lose that race, so retry briefly before deciding
  // a live daemon owns it.
  for (let attempt = 0; !ctl && attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    ctl = await control.serve(handlers);
  }
  if (!ctl) return; // a live daemon really does own the endpoint

  try {
    fs.writeFileSync(state.LOCK(), String(process.pid), 'utf8');
    fs.rmSync(state.STOP(), { force: true }); // consume a stale stop marker
  } catch {
    // The bind above is the real lock.
  }
  process.on('SIGTERM', () => shutdown());
  process.on('SIGINT', () => shutdown());

  // Put the chosen order on the panel now. The startup hook (agent-view.js
  // --reapply) only runs when Herdr's server starts; a daemon started by hand
  // — the first start after an install — used to leave Herdr's own order in
  // place until the next restart, on a machine whose README promised
  // `active`. Idempotent against the hook: the same override twice is one.
  try {
    const chosen = view.mode();
    if (chosen) await view.apply(chosen);
  } catch (error) {
    logError(error);
  }

  // The sidebar block colours the logo by matching its VALUE against glyph
  // strings, so a block written for the icon font matches nothing once the
  // variant resolves to plain Unicode — the font was installed since, or the
  // setting changed. One file read per start, and a rewrite only when they
  // actually disagree.
  try {
    const report = managed.inspect();
    if (report.text && managed.blockVariant(report.text) !== logos.resolveVariant()) {
      if (managed.apply().ok) herdr.reloadConfig();
    }
  } catch (error) {
    logError(error);
  }

  // Per-state logo names from before 2.0. A pane last painted by an older
  // version still carries one, and the new block has no cell for it, so it
  // would sit in the row unrendered but reported. Clearing them is a no-op
  // from the second start onwards.
  try {
    await state.sweepOrphans(src, new Set(), state.LEGACY_LOGO_TOKENS);
  } catch (error) {
    logError(error);
  }

  /* ------------------------------------------------------------- wiring */

  subscription = subscribe.start({
    onWake: wake,
    // The server's socket marker is gone: herdr is not coming back on this
    // endpoint. The next herdr start runs the startup hook and spawns a fresh
    // daemon.
    onGone: () => shutdown(),
  });

  // The two state sources that produce no events at all: Herdr's own config
  // (the grouped/priority toggle persists there, via atomic rename — so the
  // DIRECTORY is watched, a watched file dies with the first replacement) and
  // our own signal files (stop marker, view flag). Watchers are an
  // accelerator, not a guarantee — the catch-all deadline covers their loss.
  const watchDir = (dir, names) => {
    try {
      const watcher = fs.watch(dir, (event, file) => {
        if (!file || names.has(String(file))) wake();
      });
      watcher.on('error', () => {});
      watchers.push(watcher);
    } catch {
      // Covered by the catch-all.
    }
  };
  watchDir(path.dirname(herdrConfigPath()), new Set(['config.toml']));
  watchDir(ensureDir(stateRoot), new Set([path.basename(state.STOP()), 'agent-view.on']));

  // The tab-bar line is precomputed into a cache file that Herdr's status
  // command merely types out — the daemon pays a couple of socket calls every
  // two seconds instead of Herdr booting a node. The focused pane's cwd
  // changes under us (cd, task switch), so this one genuinely is a poll.
  const refreshTabLine = () =>
    tabline
      .snapshotLine()
      .then((line) => tabline.publish(line))
      .catch(() => {});
  timers.push(setInterval(refreshTabLine, TABLINE_MS));
  refreshTabLine();

  // Terminal titles and working directories change without an event now that
  // `pane.updated` is off (lib/subscribe.js says why). They change rarely, and
  // a frame that finds nothing different writes nothing, so a slow heartbeat
  // is the whole cost of not listening to our own echo.
  timers.push(setInterval(wake, HEARTBEAT_MS));

  // Appearance follow-up. The probe throttles itself to once a minute; sync
  // only rewrites and reloads when the desktop actually flipped.
  //
  // Spawned rather than called in-process, and that is the whole point. That
  // path REWRITES the managed config blocks, and a resident daemon would write
  // them from the module copy it loaded at startup — so an edit to the palette
  // or the row layout would be silently undone by the next desktop flip. A
  // child process always reads the code that is on disk now. It costs one
  // node start per flip, twice a day.
  if (config.followAppearance) {
    timers.push(
      setInterval(() => {
        try {
          detachedNode(path.join(__dirname, '..', 'bin', 'theme-sync.js'));
        } catch (error) {
          logError(error);
        }
      }, APPEARANCE_MS),
    );
  }

  wake();
}

module.exports = { start, logError, ERR_FILE };
