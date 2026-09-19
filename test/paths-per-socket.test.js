'use strict';

// AC1 — the path derivation everything else hangs off.
//
// Today lib/paths.js knows one state root and nothing about sockets, so every
// session's animator writes the same files. These tests pin the three exports
// that separate them: which socket this process talks to (socketPath), a
// stable short name for it (socketId), and the directory its runtime files
// belong in (runtimeDir).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { MISSING, childEnv, probePaths, sandbox } = require('./helpers');

test('AC1a runtimeDir() trennt zwei Sockets und liegt unter <stateRoot>/sockets/', (t) => {
  const box = sandbox(t);
  const a = probePaths(childEnv(box, { socket: path.join(box.base, 'a', 'herdr.sock') }));
  const b = probePaths(childEnv(box, { socket: path.join(box.base, 'b', 'herdr.sock') }));

  assert.equal(a.has.runtimeDir, 'function', MISSING.runtimeDir);

  const sockets = path.join(box.state, 'sockets') + path.sep;
  assert.ok(
    a.runtimeDir.startsWith(sockets),
    `runtimeDir() für Socket A ist ${a.runtimeDir}, erwartet unter ${sockets}`,
  );
  assert.ok(
    b.runtimeDir.startsWith(sockets),
    `runtimeDir() für Socket B ist ${b.runtimeDir}, erwartet unter ${sockets}`,
  );
  assert.notEqual(a.runtimeDir, b.runtimeDir, 'zwei verschiedene Sockets teilen sich ein Laufzeitverzeichnis');
});

test('AC1b socketId() ist prozessübergreifend stabil und zehn Hex-Zeichen lang', (t) => {
  const box = sandbox(t);
  const socket = path.join(box.base, 'named', 'herdr.sock');
  const first = probePaths(childEnv(box, { socket }));
  const second = probePaths(childEnv(box, { socket }));

  assert.equal(first.has.socketId, 'function', MISSING.socketId);
  assert.match(
    first.socketId,
    /^[0-9a-f]{10}$/,
    `socketId() ist ${JSON.stringify(first.socketId)}, erwartet 10 Hex-Zeichen`,
  );
  assert.equal(second.socketId, first.socketId, 'derselbe Socket-Pfad ergibt in zwei Prozessen verschiedene ids');
});

test('AC1c ohne HERDR_SOCKET_PATH gilt derselbe Socket wie beim expliziten Default-Pfad', (t) => {
  const box = sandbox(t);
  const implicit = probePaths(childEnv(box));
  const explicit = probePaths(childEnv(box, { socket: box.defaultSocket }));

  assert.equal(implicit.has.socketId, 'function', MISSING.socketId);
  assert.equal(implicit.has.socketPath, 'function', MISSING.socketPath);
  assert.equal(
    implicit.socketPath,
    box.defaultSocket,
    `socketPath() ohne Env ist ${implicit.socketPath}, erwartet der Default neben Herdrs config`,
  );
  assert.equal(
    implicit.socketId,
    explicit.socketId,
    'der Default-Socket bekommt eine andere id als derselbe Pfad explizit gesetzt',
  );
});

test('AC1d runtimeDir() legt sein Verzeichnis an', (t) => {
  const box = sandbox(t);
  const probe = probePaths(childEnv(box, { socket: path.join(box.base, 'fresh', 'herdr.sock') }));

  assert.equal(probe.has.runtimeDir, 'function', MISSING.runtimeDir);
  assert.equal(probe.runtimeDirIsDir, true, `${probe.runtimeDir} existiert nach dem Aufruf nicht als Verzeichnis`);
});
