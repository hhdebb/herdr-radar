'use strict';

// The daemon's own control channel — and, more importantly, its instance
// lock. A pid-file lock has a check-then-write window; two watchdog spawns
// racing through it used to cost nothing because the loser idled out in two
// seconds, but a resident loser never exits. Binding a named endpoint is
// atomic: whoever owns the pipe IS the daemon, and on Windows the pipe
// vanishes with its owner, so there is no stale-lock case at all. On unix the
// socket file can go stale after a crash; a failed ping tells it apart from a
// live owner and the file is reclaimed.
//
// Protocol: one line of JSON per connection ({cmd: "..."}), one line back.

const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const { stateRoot, ensureDir } = require('./paths');
const { NAME } = require('./identity');

function endpoint() {
  if (process.platform === 'win32') {
    // Per-user so two accounts on one machine never fight over the name.
    return `\\\\.\\pipe\\${NAME}.${os.userInfo().username}.ctl`;
  }
  return path.join(ensureDir(stateRoot), 'control.sock');
}

// One request, one reply, or null on any failure (including nobody serving).
function request(message, timeoutMs = 1500) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      stream.destroy();
      resolve(value);
    };
    const stream = net.connect({ path: endpoint() });
    let body = '';
    stream.setTimeout(timeoutMs, () => finish(null));
    stream.on('error', () => finish(null));
    stream.on('connect', () => stream.write(`${JSON.stringify(message)}\n`));
    stream.on('data', (chunk) => {
      body += chunk;
      const newline = body.indexOf('\n');
      if (newline < 0) return;
      try {
        finish(JSON.parse(body.slice(0, newline)));
      } catch {
        finish(null);
      }
    });
  });
}

// Serve `handlers` ({cmd: async (msg) => reply}). Resolves to the server, or
// null when a live instance already owns the endpoint — the caller should
// treat that as "someone else is the daemon" and exit.
async function serve(handlers) {
  const tryListen = () =>
    new Promise((resolve) => {
      const server = net.createServer((stream) => {
        let body = '';
        stream.on('error', () => stream.destroy());
        stream.on('data', async (chunk) => {
          body += chunk;
          const newline = body.indexOf('\n');
          if (newline < 0) return;
          let reply = { ok: false, error: 'bad_request' };
          try {
            const message = JSON.parse(body.slice(0, newline));
            const handler = handlers[message?.cmd];
            if (handler) reply = { ok: true, ...((await handler(message)) ?? {}) };
            else reply = { ok: false, error: 'unknown_command' };
          } catch {
            // Fall through with bad_request.
          }
          try {
            stream.end(`${JSON.stringify(reply)}\n`);
          } catch {
            stream.destroy();
          }
        });
      });
      server.on('error', () => resolve(null));
      server.listen(endpoint(), () => resolve(server));
    });

  let server = await tryListen();
  if (server) return server;

  // Bind failed. A live owner answers a ping; a corpse (unix stale socket
  // file) does not and loses the endpoint.
  if (await request({ cmd: 'ping' })) return null;
  if (process.platform !== 'win32') {
    try {
      fs.rmSync(endpoint(), { force: true });
    } catch {
      // Nothing to reclaim.
    }
    server = await tryListen();
    if (server) return server;
  }
  return null;
}

module.exports = { endpoint, request, serve };
