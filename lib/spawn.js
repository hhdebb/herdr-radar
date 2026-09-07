'use strict';

// Start another script of this plugin as a background process that outlives
// the caller. The same three options every time: `detached` so it survives
// the parent, `unref` so the parent can exit, `windowsHide` so a console
// program spawned from a parent with no console does not flash a window.

const { spawn } = require('node:child_process');

function detachedNode(script, args = [], { stdio = 'ignore', env } = {}) {
  spawn(process.execPath, [script, ...args], {
    detached: true,
    stdio,
    windowsHide: true,
    ...(env ? { env } : {}),
  }).unref();
}

module.exports = { detachedNode };
