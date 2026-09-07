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
//   node bin/agent-state.js --stop     stop it and clear its marks (titles
//                                      and sort keys stay, see state.clearAll)
//   node bin/agent-state.js --stop --purge
//                                      stop it and clear every token it ever
//                                      wrote — the uninstall path

const fs = require('node:fs');

const herdr = require('../lib/herdr');
const state = require('../lib/state');
const daemon = require('../lib/daemon');
const { stopAnimator } = require('../lib/stop');
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

const mode = process.argv.find((a) => a.startsWith('--'));
if (mode === '--animate') daemon.start();
else if (mode === '--stop') stopAnimator({ purge: process.argv.includes('--purge') });
else spawnAnimator();
