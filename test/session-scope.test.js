'use strict';

// How the daemon's runtime directory follows the Herdr session (lib/paths.js
// sessionSuffix, runtimeRoot).
//
// Herdr hands every session the same HERDR_PLUGIN_STATE_DIR, but a named
// session runs its own server on its own socket. The daemon keys its lock and
// its control endpoint off that directory, so one directory meant the second
// session's `state-start` found the first session's daemon healthy and exited.
// That daemon reports through the FIRST session's socket, so the second
// session's sidebar stayed blank: its rows are built from tokens only the
// daemon writes (#25).
//
// The default session must keep the path it has always had, or every existing
// install would orphan its lock on upgrade.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// paths.js reads the environment at load for runtimeRoot and at call time for
// sessionSuffix, so both are sampled while the variable is still set.
function pathsWith(socket) {
  const key = require.resolve('../lib/paths');
  delete require.cache[key];
  const before = process.env.HERDR_SOCKET_PATH;
  if (socket === undefined) delete process.env.HERDR_SOCKET_PATH;
  else process.env.HERDR_SOCKET_PATH = socket;
  try {
    const paths = require('../lib/paths');
    return { suffix: paths.sessionSuffix(), runtimeRoot: paths.runtimeRoot, stateRoot: paths.stateRoot };
  } finally {
    if (before === undefined) delete process.env.HERDR_SOCKET_PATH;
    else process.env.HERDR_SOCKET_PATH = before;
    delete require.cache[key];
  }
}

const CASES = [
  [undefined, '', 'no socket at all, as in a bare shell run'],
  ['/home/u/.config/herdr/herdr.sock', '', 'the default session keeps its path'],
  ['/home/u/.config/herdr/sessions/clients/herdr.sock', '-clients', 'a named session gets its own'],
  ['/home/u/.config/herdr/sessions/a b/herdr.sock', '-a_b', 'a name with a space stays path-safe'],
  ['/home/u/.config/herdr/sessions/../herdr.sock', '', 'a socket outside sessions/ is the default'],
];

for (const [socket, expected, what] of CASES) {
  test(`sessionSuffix: ${what}`, () => {
    assert.equal(pathsWith(socket).suffix, expected);
  });
}

test('two named sessions get different runtime directories', () => {
  const one = pathsWith('/home/u/.config/herdr/sessions/one/herdr.sock').runtimeRoot;
  const two = pathsWith('/home/u/.config/herdr/sessions/two/herdr.sock').runtimeRoot;
  assert.notEqual(one, two);
});

test('the default session keeps the state directory itself', () => {
  // The header above states this, and nothing asserted it: the lock, the stop
  // marker and control.sock all lived in stateRoot before per-session scoping.
  // Move them and an upgrade orphans the daemon that is still running.
  assert.equal(pathsWith(undefined).runtimeRoot, pathsWith(undefined).stateRoot);
  // A socket outside sessions/ is the default session too.
  const plain = pathsWith('/home/u/.config/herdr/herdr.sock');
  assert.equal(plain.runtimeRoot, plain.stateRoot);
});

test('a named session gets its own directory, the default keeps stateRoot', () => {
  const named = pathsWith('/home/u/.config/herdr/sessions/clients/herdr.sock');
  const fallback = pathsWith(undefined);
  assert.notEqual(named.runtimeRoot, named.stateRoot);
  assert.notEqual(named.runtimeRoot, fallback.runtimeRoot);
});

test('the runtime directory sits inside the state directory', () => {
  // The caches stay in stateRoot on purpose: they are session-agnostic, and
  // the tab-bar line picks its own per-session file (tabbar-session.test.js).
  const paths = pathsWith('/home/u/.config/herdr/sessions/clients/herdr.sock');
  assert.equal(path.dirname(paths.runtimeRoot), paths.stateRoot);
});
