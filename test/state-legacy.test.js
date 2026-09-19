'use strict';

// AC3 — what happens to the flat runtime files that every version up to 1.3.7
// wrote. An upgrade finds them lying in the state root, and the answer differs
// by socket: the default socket may still be served by the OLD daemon, which
// only knows the flat files, so a live legacy pid has to count as running or
// the upgrade starts a twin. A named socket was never served by that daemon,
// so the same files say nothing about it — and must be left alone, because the
// old daemon is still watching them.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { childEnv, runNode, sandbox } = require('./helpers');

const RUNNING_PROBE = "emit({ running: lib('state.js').animatorRunning() });";

// What a pre-1.3.8 install leaves behind: the lock, the stop marker the old
// daemon watches, and the control socket that was its instance lock. The
// socket is written as an ordinary empty file — nothing here binds it, and the
// sweep under test removes a path, not a listener.
function writeLegacy(box, pid) {
  const files = {
    lock: path.join(box.state, 'animator.pid'),
    stop: path.join(box.state, 'animator.stop'),
    sock: path.join(box.state, 'control.sock'),
  };
  fs.writeFileSync(files.lock, `${pid}\n`, 'utf8');
  fs.writeFileSync(files.stop, '', 'utf8');
  fs.writeFileSync(files.sock, '', 'utf8');
  return files;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

test('AC3a lebender Altbestand-Lock gilt auf dem Default-Socket weiter als laufend', (t) => {
  const box = sandbox(t);
  writeLegacy(box, process.pid);

  const result = runNode(childEnv(box), RUNNING_PROBE);

  assert.equal(
    result.running,
    true,
    'der alte Daemon läuft noch, wird aber nicht erkannt — der Hook startet einen Zwilling daneben',
  );
});

test('AC3b derselbe Altbestand-Lock gilt auf einem benannten Socket nicht und wird dort nicht angefasst', (t) => {
  const box = sandbox(t);
  const legacy = writeLegacy(box, process.pid);

  const result = runNode(childEnv(box, { socket: path.join(box.base, 'b', 'herdr.sock') }), RUNNING_PROBE);

  assert.equal(
    result.running,
    false,
    'der flache Lock des Default-Animators blockiert einen benannten Socket — genau der Befund, der hier behoben wird',
  );
  // The live default animator is still watching these. A sweep that runs from
  // a named socket would pull the stop marker out from under it.
  for (const [name, file] of Object.entries(legacy)) {
    assert.equal(fs.existsSync(file), true, `${name} (${file}) wurde von einem benannten Socket entfernt`);
  }
});

test('AC3c toter Altbestand-Lock gilt nicht als laufend, und alle drei flachen Dateien werden entfernt', (t) => {
  const box = sandbox(t);

  // A pid that is guaranteed gone: spawnSync only returns once the child has
  // exited and been reaped.
  const corpse = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' });
  assert.equal(corpse.status, 0, `Hilfsprozess für den toten pid lief nicht: ${corpse.error ?? corpse.stderr}`);
  assert.equal(alive(corpse.pid), false, `Voraussetzung verletzt: pid ${corpse.pid} lebt noch`);

  const legacy = writeLegacy(box, corpse.pid);
  const result = runNode(childEnv(box), RUNNING_PROBE);

  assert.equal(result.running, false, `toter pid ${corpse.pid} im Altbestand-Lock gilt als laufend`);
  for (const [name, file] of Object.entries(legacy)) {
    assert.equal(fs.existsSync(file), false, `${name} (${file}) liegt nach dem Erkennen des toten Locks immer noch da`);
  }
});
