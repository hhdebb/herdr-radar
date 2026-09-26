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

async function spawnAnimator() {
  // First start after an install: write the managed blocks, install the font.
  // Idempotent and stamped, so this is a cheap check on every later start.
  try {
    for (const note of require('../lib/setup').ensure()) console.log(note);
  } catch (error) {
    console.error(`setup: ${error.message}`);
  }
  // Asked of the endpoint, not the pid file (lib/state.js daemonStatus). A
  // stalled daemon still holds the endpoint, so a fresh one could not bind
  // beside it: it has to go first.
  let status = await state.daemonStatus();
  // A stall is confirmed before anything is ended. The ages are measured on a
  // clock that keeps counting through sleep on some platforms, so a daemon
  // asked in the first instant after a resume can look silent until its next
  // heartbeat — two of those later, it has either spoken or it really is stuck.
  if (status.state === 'stalled') {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    status = await state.daemonStatus();
  }
  if (status.state === 'healthy') return;
  let note = '';
  if (status.state === 'stalled') {
    const gone = await state.terminate(status.pid);
    note =
      `${new Date().toISOString()} replaced a stalled daemon: pid ${status.pid}, ` +
      `${status.reason}${gone ? '' : ' (it did not exit)'}\n`;
  }
  // stderr goes to a truncate-on-start log rather than the void: a detached
  // daemon that dies of an uncaught error otherwise just… stops, and the
  // sidebar quietly freezes with nothing to debug from. A replacement opens
  // the log with why it was needed, since nothing else would record it.
  let stdio = 'ignore';
  try {
    const fd = fs.openSync(daemon.ERR_FILE(), 'w');
    if (note) fs.writeSync(fd, note);
    stdio = ['ignore', 'ignore', fd];
  } catch {
    // No log is no reason not to run.
  }
  detachedNode(__filename, ['--animate'], { stdio });
}

const mode = process.argv.find((a) => a.startsWith('--'));
if (mode === '--animate') daemon.start();
else if (mode === '--stop') stopAnimator({ purge: process.argv.includes('--purge') });
else spawnAnimator();
