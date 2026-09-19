'use strict';

// AC4 — the control socket is the real instance lock (lib/control.js:22):
// whoever binds it IS the daemon. Moving it under runtimeDir() is what lets a
// second animator exist at all, and it runs straight into the limit that makes
// unix sockets different from ordinary files — `sun_path` holds 108 bytes
// INCLUDING the terminator, and a path over it fails at bind, not at open.
//
// Windows names a pipe instead of a path and has no such limit, so the whole
// file is unix-only.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { MISSING, childEnv, probePaths, runNode, sandbox } = require('./helpers');

const unixOnly = process.platform === 'win32' ? 'unix-Sockets: auf win32 ist der Endpoint ein Pipe-Name' : false;

const ENDPOINT_PROBE = "emit({ endpoint: lib('control.js').endpoint() });";

test('AC4a control.endpoint() liegt unter runtimeDir() und bleibt unter 108 Byte', { skip: unixOnly }, (t) => {
  const box = sandbox(t);
  const socket = path.join(box.base, 'named', 'herdr.sock');

  const probe = probePaths(childEnv(box, { socket }));
  assert.equal(probe.has.runtimeDir, 'function', MISSING.runtimeDir);

  const { endpoint } = runNode(childEnv(box, { socket }), ENDPOINT_PROBE);
  const bytes = Buffer.byteLength(endpoint, 'utf8');

  assert.ok(
    endpoint.startsWith(probe.runtimeDir + path.sep),
    `control.endpoint() ist ${endpoint}, erwartet unter ${probe.runtimeDir}`,
  );
  assert.ok(
    bytes < 108,
    `control.endpoint() ist ${bytes} Byte lang (${endpoint}); bind() nimmt nur 107 plus Terminator`,
  );
});

test('AC4b langer stateRoot weicht auf einen kurzen Pfad aus, statt bind() zu sprengen', { skip: unixOnly }, (t) => {
  const box = sandbox(t, { stateName: 'x'.repeat(120) });

  const { endpoint } = runNode(childEnv(box, { socket: path.join(box.base, 'named', 'herdr.sock') }), ENDPOINT_PROBE);
  const bytes = Buffer.byteLength(endpoint, 'utf8');

  assert.ok(
    bytes < 108,
    `control.endpoint() ist bei ${Buffer.byteLength(box.state, 'utf8')} Byte stateRoot ${bytes} Byte lang ` +
      `(${endpoint}) — der Daemon kann seinen Endpoint nicht binden und beendet sich`,
  );
});
