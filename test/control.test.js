'use strict';

// One request, one reply, or null — never a promise left hanging
// (lib/control.js request).
//
// Each test serves its own throwaway endpoint. The real one is named per user,
// and binding it here would collide with the daemon actually running.

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const control = require('../lib/control');

function endpoint() {
  const name = `herdr-radar-test-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  return process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : path.join(os.tmpdir(), `${name}.sock`);
}

// `server.close()` only calls back once every connection it accepted has ended,
// and on a Windows pipe the server's half of a connection the client destroyed
// can stay open — so the test's own teardown waited forever. Every accepted
// socket is tracked and destroyed first.
function serve(t, onConnection) {
  const at = endpoint();
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    onConnection(socket);
  });
  t.after(
    () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  );
  return new Promise((resolve) => server.listen(at, () => resolve(at)));
}

// A promise that never settles would, with nothing else pending, let the
// process exit 0 in the middle of the test. Racing it against a deadline turns
// "hung" into a plain failure.
function within(ms, promise) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`still unsettled after ${ms}ms`)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

// The bug this pins: a peer that hangs up cleanly — a daemon caught mid-exit
// does — fires no error and no data, and the close clears the socket timeout.
// The promise never settled, and a launcher that had just ended a stalled
// daemon exited 0 before starting the replacement.
test('a peer that hangs up without a reply settles to null, promptly', async (t) => {
  const at = await serve(t, (socket) => socket.end());
  const started = performance.now();
  const reply = await within(3000, control.request({ cmd: 'ping' }, 1500, at));
  assert.equal(reply, null);
  assert.ok(performance.now() - started < 1000, 'settled by the timeout, not by the hang-up');
});

// And the close must not pre-empt a reply that arrived just before it.
test('a reply followed by a hang-up is still read', async (t) => {
  const at = await serve(t, (socket) => socket.end(`${JSON.stringify({ ok: true, pid: 42 })}\n`));
  const reply = await within(3000, control.request({ cmd: 'ping' }, 1500, at));
  assert.deepEqual(reply, { ok: true, pid: 42 });
});

test('nobody serving settles to null', async () => {
  const reply = await within(3000, control.request({ cmd: 'ping' }, 1500, endpoint()));
  assert.equal(reply, null);
});
