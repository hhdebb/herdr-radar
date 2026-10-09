'use strict';

// One tab-bar line per Herdr session (lib/paths.js tabbarCache).
//
// With a daemon per session, a single tabbar.txt had two writers, and one
// session's tab bar showed the other session's directory until its own line
// next changed. Each daemon now writes the file named for its session, and
// the one status command in config.toml picks the file from HERDR_SESSION —
// which Herdr sets in a named session's server, and so in everything that
// server starts, and never in the default session's.
//
// The command is run here the way Herdr runs it: `cmd /d /c` on Windows,
// `/bin/sh -lc` elsewhere.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// stateRoot is read once, at load.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-tabbar-session-'));
process.env.HERDR_RADAR_STATE = root;
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const { tabbarCache } = require('../lib/paths');
const tabline = require('../lib/tabline');
const managed = require('../lib/managed-config');

function withSession(session, fn) {
  const before = process.env.HERDR_SESSION;
  if (session === undefined) delete process.env.HERDR_SESSION;
  else process.env.HERDR_SESSION = session;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env.HERDR_SESSION;
    else process.env.HERDR_SESSION = before;
  }
}

const NAMES = [
  [undefined, 'tabbar.txt', 'the default session keeps the name it always had'],
  ['', 'tabbar.txt', 'an empty variable is the default session'],
  ['default', 'tabbar.txt', 'so is one that names it'],
  ['work', 'tabbar-work.txt', 'a named session gets its own'],
  ['a b', 'tabbar.txt', 'a name Herdr would refuse is not used as a file name'],
];

for (const [session, file, what] of NAMES) {
  test(`tabbarCache: ${what}`, () => {
    assert.equal(
      withSession(session, () => tabbarCache()),
      path.join(root, file),
    );
  });
}

test('the daemon publishes to its own session file', () => {
  assert.equal(
    withSession('work', () => tabline.CACHE()),
    path.join(root, 'tabbar-work.txt'),
  );
  assert.equal(
    withSession(undefined, () => tabline.CACHE()),
    path.join(root, 'tabbar.txt'),
  );
});

function statusCommand() {
  const line = managed
    .block()
    .split('\n')
    .find((row) => row.includes("command = '"));
  return line.match(/command = '([^']*)'/)[1];
}

function run(command, session) {
  const env = { ...process.env };
  delete env.HERDR_SESSION;
  if (session) env.HERDR_SESSION = session;
  const result =
    process.platform === 'win32'
      ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', command], { env, windowsVerbatimArguments: true })
      : spawnSync('/bin/sh', ['-lc', command], { env });
  return result.stdout.toString().trim();
}

test('the status command reads the file of the session it runs in', () => {
  fs.writeFileSync(path.join(root, 'tabbar.txt'), 'default line\n');
  fs.writeFileSync(path.join(root, 'tabbar-work.txt'), 'work line\n');
  const command = statusCommand();
  assert.equal(run(command, undefined), 'default line');
  assert.equal(run(command, 'work'), 'work line');
});

test('a tab-bar block from before 1.4.4 is stale, the current one is not', () => {
  const current = managed.block();
  const old = current.replace(/command = '[^']*'/, `command = 'type "${path.join(root, 'tabbar.txt')}"'`);
  assert.equal(managed.tabBarStale(`[ui]\n${current}\n`), false);
  assert.equal(managed.tabBarStale(`[ui]\n${old}\n`), true);
  assert.equal(managed.tabBarStale('[ui]\n'), false);
});
