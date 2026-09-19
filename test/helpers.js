'use strict';

// Shared plumbing for the per-socket runtime tests.
//
// Two things every scenario here needs.
//
// ISOLATION. The machine a test runs on has a real animator holding a real
// lock under Herdr's own state directory, and a real socket next to Herdr's
// own config. A test that reads either would see that animator; a test that
// writes either would disturb it. So every scenario gets its own temporary
// HERDR_RADAR_STATE and XDG_CONFIG_HOME, and the child's environment is BUILT
// rather than inherited — an inherited HERDR_SOCKET_PATH or
// HERDR_PLUGIN_STATE_DIR would silently point the test back at the real
// installation, and the test would pass or fail for a reason that has nothing
// to do with the code under it.
//
// A CHILD PROCESS PER SCENARIO. lib/paths.js computes `stateRoot` once, while
// the module loads (lib/paths.js:23), so two scenarios with different state
// roots cannot share one process. Emptying the require cache would re-run that
// computation but leave every module that already captured the old value
// behind; a child process has no such seam.
//
// This file is deliberately not named `*.test.js`: `node --test test/` picks up
// only files matching the test-file patterns, verified on Node 20.20.2 (what CI
// runs) and Node 26.9.0 (what this was written on).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');

// The child prints exactly one marked line. Marking it means a stray warning on
// stdout cannot be mistaken for the result, and a missing line reports the
// child's own stderr instead of a JSON parse error three frames away from the
// cause.
const MARKER = '__herdr_radar_test__';

// Variables the sandbox lets through. `gsettings` (lib/appearance.js) needs a
// session bus to answer at all, and a test that silently skips because the bus
// was stripped measures the sandbox, not the code.
const PASS_THROUGH = ['PATH', 'LANG', 'DISPLAY', 'WAYLAND_DISPLAY', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR'];

// The assertion messages for exports the target architecture adds. A bare
// `TypeError: paths.runtimeDir is not a function` says which line broke; these
// say which behaviour is missing, which is the thing a red test is for.
const MISSING = {
  socketPath: 'lib/paths.js exportiert socketPath() noch nicht — es gibt keine einzige Quelle für den Socket-Pfad',
  socketId: 'lib/paths.js exportiert socketId() noch nicht — Sockets sind nicht voneinander unterscheidbar',
  runtimeDir: 'lib/paths.js exportiert runtimeDir() noch nicht — Laufzeitdateien können nicht je Socket liegen',
};

// One scenario's private world: a state root, a config home (which is where
// the DEFAULT socket path is derived from, lib/paths.js:45-47), and a home
// directory, so even a lookup that bypasses XDG lands inside the sandbox.
//
// `stateName` exists for the endpoint-length case, which needs a state root
// long enough to push a unix socket path past the 108-byte limit.
function sandbox(t, { stateName = 'state' } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-radar-test-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));

  const box = {
    base,
    state: path.join(base, stateName),
    configHome: path.join(base, 'config'),
    home: path.join(base, 'home'),
    xdgState: path.join(base, 'xdg-state'),
  };
  // The config directory has to exist before Herdr's socket would sit in it.
  box.defaultSocket = path.join(box.configHome, 'herdr', 'herdr.sock');
  for (const dir of [box.state, path.dirname(box.defaultSocket), box.home, box.xdgState]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return box;
}

// The environment a child runs in. Built from nothing, so the real
// installation cannot leak in. `socket` unset means the default-socket case —
// the variable is absent, not empty, because lib/ipc.js:22 tests for absence
// with `??` and an empty string would take a different branch.
function childEnv(box, { socket, state } = {}) {
  const env = {
    HOME: box.home,
    XDG_CONFIG_HOME: box.configHome,
    XDG_STATE_HOME: box.xdgState,
    HERDR_RADAR_STATE: state ?? box.state,
  };
  for (const name of PASS_THROUGH) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  if (socket !== undefined) env.HERDR_SOCKET_PATH = socket;
  return env;
}

// Run `body` in a child with `env` and return what it emitted. `lib('x.js')`
// and `emit(value)` are the two things a body needs; `fs` and `path` are there
// because every body so far wanted them.
function runNode(env, body) {
  const script = [
    "'use strict';",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    `const LIB = ${JSON.stringify(path.join(REPO, 'lib'))};`,
    'const lib = (name) => require(path.join(LIB, name));',
    `const emit = (value) => console.log(${JSON.stringify(MARKER)} + JSON.stringify(value));`,
    body,
  ].join('\n');

  const result = spawnSync(process.execPath, ['-e', script], { env, encoding: 'utf8' });
  if (result.error) throw result.error;
  const line = (result.stdout ?? '').split('\n').find((text) => text.startsWith(MARKER));
  if (line === undefined) {
    throw new Error(
      `Kindprozess lieferte kein Ergebnis (exit ${result.status}, signal ${result.signal}).\n` +
        `stdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
  return JSON.parse(line.slice(MARKER.length));
}

// Everything lib/paths.js can say about one socket, in one child. Reported as
// `typeof` first so a missing export comes back as data the test can name,
// rather than as a TypeError thrown inside the child.
const PATHS_PROBE = `
  const paths = lib('paths.js');
  const has = {
    socketPath: typeof paths.socketPath,
    socketId: typeof paths.socketId,
    runtimeDir: typeof paths.runtimeDir,
  };
  const runtimeDir = has.runtimeDir === 'function' ? paths.runtimeDir() : null;
  emit({
    has,
    stateRoot: paths.stateRoot,
    socketPath: has.socketPath === 'function' ? paths.socketPath() : null,
    socketId: has.socketId === 'function' ? paths.socketId() : null,
    runtimeDir,
    runtimeDirIsDir: runtimeDir !== null && fs.existsSync(runtimeDir) && fs.statSync(runtimeDir).isDirectory(),
  });
`;

function probePaths(env) {
  return runNode(env, PATHS_PROBE);
}

module.exports = { MISSING, REPO, childEnv, probePaths, runNode, sandbox };
