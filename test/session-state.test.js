'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const paths = path.join(__dirname, '..', 'lib', 'paths.js');

function roots(socket) {
  const env = { ...process.env, HERDR_RADAR_STATE: '/s', HERDR_SOCKET_PATH: socket };
  if (socket === undefined) delete env.HERDR_SOCKET_PATH;
  const out = spawnSync(
    process.execPath,
    [
      '-e',
      `const p=require(${JSON.stringify(paths)});console.log(JSON.stringify([p.stateRoot,p.sharedStateRoot,p.sessionName()]))`,
    ],
    { env, encoding: 'utf8' },
  );
  return JSON.parse(out.stdout);
}

test('default session keeps the shared state directory', () => {
  assert.deepStrictEqual(roots('/h/.config/herdr/herdr.sock'), ['/s', '/s', null]);
  assert.deepStrictEqual(roots(undefined), ['/s', '/s', null]);
});

test('a named session gets its own state directory, tab-bar cache stays shared', () => {
  assert.deepStrictEqual(roots('/h/.config/herdr/sessions/firstmate/herdr.sock'), [
    '/s/sessions/firstmate',
    '/s',
    'firstmate',
  ]);
});
