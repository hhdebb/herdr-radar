'use strict';

// AC8 — the tab-bar cache is the one runtime file that stays global, and it
// stays global because the thing that READS it cannot be made per-socket: the
// managed tab-bar block in Herdr's config.toml is written once and `cat`s a
// fixed path, `<stateRoot>/tabbar.txt` (lib/managed-config.js:144). There is
// one tab bar on the screen, so there is one file — and only the default
// socket's animator may write it. If every daemon wrote, whichever session
// refreshed last would overwrite the line of the session actually being looked
// at.
//
// This is the decision recorded as Option A. Should Option B land instead, it
// is this file that changes.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { childEnv, runNode, sandbox } = require('./helpers');

// `publish()` is a plain file operation — it composes nothing and talks to no
// socket — and its in-memory dedupe (`published`) starts empty in every child.
function publish(box, socket) {
  return runNode(
    childEnv(box, { socket }),
    `
      const paths = lib('paths.js');
      lib('tabline.js').publish('hello');
      const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
      const runtimeDir = typeof paths.runtimeDir === 'function' ? paths.runtimeDir() : null;
      emit({
        hasRuntimeDir: typeof paths.runtimeDir,
        runtimeDir,
        flat: read(path.join(paths.stateRoot, 'tabbar.txt')),
        perSocket: runtimeDir === null ? null : read(path.join(runtimeDir, 'tabbar.txt')),
      });
    `,
  );
}

test('AC8a ein benannter Socket schreibt überhaupt keine tabbar.txt', (t) => {
  const box = sandbox(t);
  const result = publish(box, path.join(box.base, 'b', 'herdr.sock'));

  assert.equal(
    result.flat,
    null,
    `ein benannter Socket schreibt weiterhin <stateRoot>/tabbar.txt (${JSON.stringify(result.flat)}) und ` +
      'überschreibt damit die Zeile der fokussierten Session',
  );
  // Only checkable once the export exists; until then the assertion above is
  // the one that carries this criterion.
  if (result.hasRuntimeDir === 'function') {
    assert.equal(
      result.perSocket,
      null,
      `${path.join(result.runtimeDir, 'tabbar.txt')} wurde angelegt — die Datei bleibt global, ` +
        'eine Kopie je Socket liest niemand',
    );
  }
});

test('AC8b der Default-Socket schreibt sie weiterhin flach in den stateRoot', (t) => {
  const box = sandbox(t);
  const result = publish(box);

  assert.equal(
    result.flat,
    'hello\n',
    `<stateRoot>/tabbar.txt enthält ${JSON.stringify(result.flat)}, erwartet "hello\\n" — der Tab-Bar-Block ` +
      'in config.toml liest genau diesen Pfad',
  );
});
