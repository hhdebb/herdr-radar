'use strict';

// Stop the resident daemon and take its paint off the sidebar. Shared by the
// `state-stop` action and by `configure --uninstall`, which has to stop the
// daemon before it removes the blocks that render the tokens — otherwise a
// detached process keeps writing state into a sidebar that no longer shows it.

const fs = require('fs');
const control = require('./control');
const herdr = require('./herdr');
const state = require('./state');

// Whatever still answers the endpoint once the polite routes have had their
// time is ended outright. The pid is the one the endpoint reports, never the
// pid file's (lib/state.js terminate says why).
async function forceIfStillThere() {
  const status = await state.daemonStatus();
  if (status.state !== 'none') await state.terminate(status.pid);
}

// `purge` clears the tokens a plain stop leaves in place (titles, sort keys,
// the vendor logo) — see state.clearAll for why a stop keeps them.
async function stopAnimator({ purge = false } = {}) {
  const src = herdr.source();
  // Fast path: ask the daemon directly. It clears everything itself and exits
  // once the reply is on the wire — no marker files, no polling.
  const reply = await control.request({ cmd: 'stop' }, 10000);
  if (reply?.ok) {
    // The reply can arrive while the exit it promises never does: the daemon
    // leaves on a timer after answering, and a stalled one's timers are the
    // thing that stalled (#18).
    if (!(await state.waitForExit(3000))) await forceIfStillThere();
  } else {
    // Legacy path, for a daemon too old to know `stop`: drop a stop marker
    // (the daemon watches its state directory, so it is seen within
    // milliseconds), wait for it to exit, then clear the tokens. Clearing
    // while it still ticks loses the race — it repaints a working pane every
    // frame.
    try {
      fs.writeFileSync(state.STOP(), '', 'utf8');
    } catch {
      // Nothing to signal.
    }
    if (!(await state.waitForExit(8000))) await forceIfStillThere();
    // The marker stays. Silence on the endpoint is not proof the daemon has
    // read it — one that is alive but unreachable still has to see it on its
    // next frame. It is consumed either way: by that daemon on its way out, or
    // by the next one, which clears a stale marker right after binding and
    // before its first frame. The pid file is diagnostics now and needs no
    // tidying.
    await state.clearAll(src);
  }
  if (purge) await state.clearAll(src, { purge: true });
  return (await state.daemonStatus()).state === 'none';
}

module.exports = { stopAnimator };
