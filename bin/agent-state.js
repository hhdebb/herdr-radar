#!/usr/bin/env node
'use strict';

require('../lib/node-version');

// Lifecycle-state glyphs for the sidebar: a braille spinner while an agent
// works, a green check when it finishes, a mark for blocked / idle / unknown.
// The work is done by a resident daemon (lib/daemon.js); this is its command
// line.
//
//   node bin/agent-state.js            make sure the daemon is running (this
//                                      is what Herdr's startup hook and the
//                                      watchdog event call)
//   node bin/agent-state.js --animate  BE the daemon
//   node bin/agent-state.js --stop     stop it and clear its tokens

const fs = require('node:fs');

const herdr = require('../lib/herdr');
const state = require('../lib/state');
const control = require('../lib/control');
const daemon = require('../lib/daemon');
const { detachedNode } = require('../lib/spawn');

function spawnAnimator() {
  // First start after an install: write the managed blocks, install the font.
  // Idempotent and stamped, so this is a cheap check on every later start.
  try {
    for (const note of require('../lib/setup').ensure()) console.log(note);
  } catch (error) {
    console.error(`setup: ${error.message}`);
  }
  if (state.animatorRunning()) return;
  // stderr goes to a truncate-on-start log rather than the void: a detached
  // daemon that dies of an uncaught error otherwise just… stops, and the
  // sidebar quietly freezes with nothing to debug from.
  let stdio = 'ignore';
  try {
    stdio = ['ignore', 'ignore', fs.openSync(daemon.ERR_FILE(), 'w')];
  } catch {
    // No log is no reason not to run.
  }
  detachedNode(__filename, ['--animate'], { stdio });
}

// Synchronous sleep; the stop path is a rare manual action and has to block.
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

async function stopAnimator() {
  // Fast path: ask the daemon directly. It clears everything itself and exits
  // once the reply is on the wire — no marker files, no polling.
  const reply = await control.request({ cmd: 'stop' }, 10000);
  if (reply?.ok) {
    const deadline = Date.now() + 3000;
    while (state.animatorRunning() && Date.now() < deadline) sleep(50);
    return;
  }

  // Legacy path, for a daemon too old or too wedged to answer its pipe: drop
  // a stop marker (the daemon watches its state directory, so it is seen
  // within milliseconds), wait for it to exit, then clear the tokens. Clearing
  // while it still ticks loses the race — it repaints a working pane every
  // frame.
  try {
    fs.writeFileSync(state.STOP(), '', 'utf8');
  } catch {
    // Nothing to signal.
  }
  const deadline = Date.now() + 8000;
  while (state.animatorRunning() && Date.now() < deadline) sleep(100);
  if (!state.animatorRunning()) {
    try {
      fs.rmSync(state.LOCK(), { force: true }); // a stale pid file, if any
      fs.rmSync(state.STOP(), { force: true });
    } catch {
      // Leftovers only delay the next start by one wake.
    }
  }
  await state.clearAll(herdr.source());
}

const mode = process.argv.find((a) => a.startsWith('--'));
if (mode === '--animate') daemon.start();
else if (mode === '--stop') stopAnimator();
else spawnAnimator();
