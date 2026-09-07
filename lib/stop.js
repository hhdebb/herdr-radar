'use strict';

// Stop the resident daemon and take its paint off the sidebar. Shared by the
// `state-stop` action and by `configure --uninstall`, which has to stop the
// daemon before it removes the blocks that render the tokens — otherwise a
// detached process keeps writing state into a sidebar that no longer shows it.

const fs = require('fs');
const control = require('./control');
const herdr = require('./herdr');
const state = require('./state');

// Synchronous sleep; the stop path is a rare manual action and has to block.
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// `purge` clears the tokens a plain stop leaves in place (titles, sort keys,
// the vendor logo) — see state.clearAll for why a stop keeps them.
async function stopAnimator({ purge = false } = {}) {
  const src = herdr.source();
  // Fast path: ask the daemon directly. It clears everything itself and exits
  // once the reply is on the wire — no marker files, no polling.
  const reply = await control.request({ cmd: 'stop' }, 10000);
  if (reply?.ok) {
    const deadline = Date.now() + 3000;
    while (state.animatorRunning() && Date.now() < deadline) sleep(50);
  } else {
    // Legacy path, for a daemon too old or too wedged to answer its pipe: drop
    // a stop marker (the daemon watches its state directory, so it is seen
    // within milliseconds), wait for it to exit, then clear the tokens.
    // Clearing while it still ticks loses the race — it repaints a working
    // pane every frame.
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
    await state.clearAll(src);
  }
  if (purge) await state.clearAll(src, { purge: true });
  return !state.animatorRunning();
}

module.exports = { stopAnimator };
