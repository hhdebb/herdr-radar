'use strict';

// Herdr's socket API, for the writes the CLI wrapper makes too slow.
//
// Every `herdr` CLI call is a process spawn — 40-80ms on Windows — and the
// animator writes tokens per pane, so a mode flip that repaints thirty panes
// crawled through seconds of serial spawns while the sidebar visibly walked
// into place. The socket takes the same requests as newline-delimited JSON;
// the server answers one request per connection and hangs up, so calls are
// parallel by construction. A small in-flight cap keeps a full repaint from
// opening seventy pipes at once.

const net = require('node:net');
const path = require('node:path');

const { herdrConfigPath } = require('./paths');

const TIMEOUT_MS = 4000;
const MAX_IN_FLIGHT = 16;

function pipePath() {
  const sock =
    process.env.HERDR_SOCKET_PATH ?? path.join(path.dirname(herdrConfigPath()), 'herdr.sock');
  // Herdr's Windows listener registers the whole path string as a named pipe.
  return process.platform === 'win32' ? `\\\\.\\pipe\\${sock}` : sock;
}

function rawCall(method, params) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      stream.destroy();
      resolve(value);
    };
    const stream = net.connect({ path: pipePath() });
    let body = '';
    stream.setTimeout(TIMEOUT_MS, () => finish(null));
    stream.on('error', () => finish(null));
    stream.on('connect', () =>
      stream.write(`${JSON.stringify({ id: 'plugin-ipc', method, params })}\n`),
    );
    stream.on('data', (chunk) => {
      body += chunk;
      const line = body.indexOf('\n');
      if (line < 0) return;
      try {
        finish(JSON.parse(body.slice(0, line)));
      } catch {
        finish(null);
      }
    });
  });
}

let inFlight = 0;
const waiters = [];

// The parsed reply, or null on any transport failure. A reply with an
// `error` field is still returned — the caller decides what a refusal means.
async function call(method, params) {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise((wake) => waiters.push(wake));
  inFlight += 1;
  try {
    return await rawCall(method, params);
  } finally {
    inFlight -= 1;
    waiters.shift()?.();
  }
}

module.exports = { call };
