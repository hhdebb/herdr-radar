'use strict';

// AC2 — the lock is what keeps a second animator from starting, and today it
// is global: `state.animatorRunning()` reads <stateRoot>/animator.pid whatever
// socket the process belongs to (lib/state.js:87,99). That is why a session on
// a named socket starts its hook, sees the DEFAULT animator's pid alive, and
// returns without ever animating its own sidebar.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { MISSING, childEnv, probePaths, runNode, sandbox } = require('./helpers');

const RUNNING_PROBE = "emit({ running: lib('state.js').animatorRunning() });";

test('AC2a animatorRunning() sieht einen fremden Socket-Lock nicht', (t) => {
  const box = sandbox(t);
  const socketA = path.join(box.base, 'a', 'herdr.sock');
  const socketB = path.join(box.base, 'b', 'herdr.sock');

  const a = probePaths(childEnv(box, { socket: socketA }));
  assert.equal(a.has.runtimeDir, 'function', MISSING.runtimeDir);

  // This test process is the live animator of socket A: its pid is alive by
  // construction, which is what `pidAlive` checks for.
  fs.mkdirSync(a.runtimeDir, { recursive: true });
  fs.writeFileSync(path.join(a.runtimeDir, 'animator.pid'), `${process.pid}\n`, 'utf8');

  const underA = runNode(childEnv(box, { socket: socketA }), RUNNING_PROBE);
  const underB = runNode(childEnv(box, { socket: socketB }), RUNNING_PROBE);

  assert.equal(underA.running, true, 'der eigene Lock von Socket A wird unter Socket A nicht als laufend erkannt');
  assert.equal(underB.running, false, 'der Lock von Socket A gilt unter Socket B als laufend — Socket B animiert nie');
});

test('AC2b LOCK() und STOP() liegen unter runtimeDir(), nicht flach im stateRoot', (t) => {
  const box = sandbox(t);
  const socket = path.join(box.base, 'named', 'herdr.sock');
  const probe = probePaths(childEnv(box, { socket }));
  assert.equal(probe.has.runtimeDir, 'function', MISSING.runtimeDir);

  const files = runNode(
    childEnv(box, { socket }),
    `
      const state = lib('state.js');
      emit({ lock: state.LOCK(), stop: state.STOP() });
    `,
  );

  const runtime = probe.runtimeDir + path.sep;
  assert.ok(files.lock.startsWith(runtime), `state.LOCK() ist ${files.lock}, erwartet unter ${runtime}`);
  assert.ok(files.stop.startsWith(runtime), `state.STOP() ist ${files.stop}, erwartet unter ${runtime}`);
});
