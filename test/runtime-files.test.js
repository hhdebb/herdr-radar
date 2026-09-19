'use strict';

// AC5 — the files an animator owns while it runs. Every one of them is
// per-process state that today is written to one shared place: the crash log
// (lib/daemon.js:43), the view flag (lib/view.js:19), the activity stamps
// (lib/activity.js:18) and the appearance cache (lib/appearance.js:26). Two
// animators on one machine overwrite each other's, which is why they move
// under runtimeDir() while the setup and config files stay global.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { MISSING, childEnv, runNode, sandbox } = require('./helpers');

// Every probe in this file answers the same three questions for one file
// name: where runtimeDir() is, whether the file landed there, and whether a
// flat copy is still being written beside it.
function inspect(box, socket, body) {
  return runNode(
    childEnv(box, { socket }),
    `
      const paths = lib('paths.js');
      const hasRuntimeDir = typeof paths.runtimeDir === 'function';
      const runtimeDir = hasRuntimeDir ? paths.runtimeDir() : null;
      const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
      const perSocket = (name) => (runtimeDir === null ? null : read(path.join(runtimeDir, name)));
      const flat = (name) => read(path.join(paths.stateRoot, name));
      ${body}
    `,
  );
}

const SOCKET = 'named/herdr.sock';

test('AC5a daemon.ERR_FILE() liegt unter runtimeDir()', (t) => {
  const box = sandbox(t);
  const result = inspect(
    box,
    path.join(box.base, SOCKET),
    "emit({ hasRuntimeDir: typeof paths.runtimeDir, runtimeDir, errFile: lib('daemon.js').ERR_FILE() });",
  );

  assert.equal(result.hasRuntimeDir, 'function', MISSING.runtimeDir);
  assert.ok(
    result.errFile.startsWith(result.runtimeDir + path.sep),
    `daemon.ERR_FILE() ist ${result.errFile}, erwartet unter ${result.runtimeDir} — sonst schreiben zwei Animatoren ` +
      'ihre Stacktraces in dieselbe Datei',
  );
});

test('AC5b view.setMode() schreibt das View-Flag je Socket und liest es zurück', (t) => {
  const box = sandbox(t);
  const result = inspect(
    box,
    path.join(box.base, SOCKET),
    `
      const view = lib('view.js');
      view.setMode('recent');
      emit({
        hasRuntimeDir: typeof paths.runtimeDir,
        runtimeDir,
        perSocket: perSocket('agent-view.on'),
        flat: flat('agent-view.on'),
        mode: view.mode(),
      });
    `,
  );

  assert.equal(result.hasRuntimeDir, 'function', MISSING.runtimeDir);
  assert.equal(
    result.perSocket,
    'recent',
    `${path.join(result.runtimeDir ?? '<runtimeDir>', 'agent-view.on')} enthält ${JSON.stringify(result.perSocket)}, erwartet "recent"`,
  );
  assert.equal(
    result.flat,
    null,
    `<stateRoot>/agent-view.on wird weiterhin geschrieben (${JSON.stringify(result.flat)})`,
  );
  assert.equal(result.mode, 'recent', `view.mode() liefert ${JSON.stringify(result.mode)} statt "recent"`);
});

test('AC5c activity.save()/load() arbeiten auf der Datei des eigenen Sockets', (t) => {
  const box = sandbox(t);
  const result = inspect(
    box,
    path.join(box.base, SOCKET),
    `
      const activity = lib('activity.js');
      activity.save(new Map([['p1', 1]]), Date.now(), { force: true });
      emit({
        hasRuntimeDir: typeof paths.runtimeDir,
        runtimeDir,
        perSocket: perSocket('activity.json'),
        flat: flat('activity.json'),
        loaded: activity.load().get('p1') ?? null,
      });
    `,
  );

  assert.equal(result.hasRuntimeDir, 'function', MISSING.runtimeDir);
  assert.notEqual(
    result.perSocket,
    null,
    `${path.join(result.runtimeDir ?? '<runtimeDir>', 'activity.json')} wurde nicht geschrieben`,
  );
  assert.equal(result.loaded, 1, `activity.load() liefert für p1 ${JSON.stringify(result.loaded)} statt 1`);
  assert.equal(
    result.flat,
    null,
    `<stateRoot>/activity.json wird weiterhin geschrieben (${JSON.stringify(result.flat)})`,
  );
});

test('AC5d appearance.current() legt seinen Cache je Socket ab', (t) => {
  const box = sandbox(t);
  const result = inspect(
    box,
    path.join(box.base, SOCKET),
    `
      const value = lib('appearance.js').current();
      emit({
        hasRuntimeDir: typeof paths.runtimeDir,
        runtimeDir,
        value,
        perSocket: perSocket('appearance.json'),
        flat: flat('appearance.json'),
      });
    `,
  );

  // No answer from the OS means no cache to place. lib/appearance.js:95 only
  // writes when the probe returned something, so there is nothing to assert —
  // on a Linux box that is a missing `gsettings` or no session bus to reach it.
  if (result.value === null) {
    t.skip(
      `appearance.current() liefert auf diesem Host null (kein gsettings/Session-Bus) — es wird keine Datei geschrieben`,
    );
    return;
  }

  assert.equal(result.hasRuntimeDir, 'function', MISSING.runtimeDir);
  assert.notEqual(
    result.perSocket,
    null,
    `${path.join(result.runtimeDir ?? '<runtimeDir>', 'appearance.json')} wurde nicht geschrieben (Appearance: ${result.value})`,
  );
  assert.equal(
    result.flat,
    null,
    `<stateRoot>/appearance.json wird weiterhin geschrieben (${JSON.stringify(result.flat)})`,
  );
});
