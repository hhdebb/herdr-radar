'use strict';

// What a failed appearance probe must NOT do.
//
// On macOS the probe reads `defaults read -g AppleInterfaceStyle`, and a
// non-zero exit is how light mode announces itself: the key simply does not
// exist there. So the exit code alone cannot say whether the desktop is light
// or whether the command never ran. `error` can: node sets it for ENOENT and
// for ETIMEDOUT, and leaves it unset when `defaults` exits 1 by itself.
//
// Measured on macOS 15:
//   dark             status 0    error unset
//   light            status 1    error unset
//   timeout          status null error ETIMEDOUT
//   missing binary   status null error ENOENT
//
// Without the distinction a loaded machine reads as light, the plugin rewrites
// `[theme] name` to the light theme, and a dark desktop turns white mid-work.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-probe-'));
process.env.HERDR_RADAR_STATE = path.join(sandbox, 'state');

const test = require('node:test');
const assert = require('node:assert/strict');

test.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

// appearance.js destructures spawnSync at load, so the stub has to be in place
// before the module is required, and the module has to be loaded again for
// each case.
function appearanceWith(result) {
  const real = childProcess.spawnSync;
  childProcess.spawnSync = () => result;
  const key = require.resolve('../lib/appearance');
  delete require.cache[key];
  try {
    return require('../lib/appearance');
  } finally {
    childProcess.spawnSync = real;
    delete require.cache[key];
  }
}

const CACHE = () => path.join(process.env.HERDR_RADAR_STATE, 'appearance.json');

function seed(entry) {
  fs.mkdirSync(path.dirname(CACHE()), { recursive: true });
  fs.writeFileSync(CACHE(), JSON.stringify(entry), 'utf8');
}

if (process.platform === 'darwin') {
  test('a probe that timed out does not read as light', () => {
    seed({ value: 'dark', applied: 'dark', at: 0 });
    const appearance = appearanceWith({
      status: null,
      signal: 'SIGTERM',
      stdout: '',
      error: Object.assign(new Error('spawnSync defaults ETIMEDOUT'), { code: 'ETIMEDOUT' }),
    });
    assert.equal(appearance.current(Date.now(), { fresh: true }), 'dark');
  });

  test('a probe that never started does not read as light', () => {
    seed({ value: 'dark', applied: 'dark', at: 0 });
    const appearance = appearanceWith({
      status: null,
      signal: null,
      stdout: '',
      error: Object.assign(new Error('spawnSync defaults ENOENT'), { code: 'ENOENT' }),
    });
    assert.equal(appearance.current(Date.now(), { fresh: true }), 'dark');
  });

  test('a failed probe reports no change, so nothing is rewritten', () => {
    seed({ value: 'dark', applied: 'dark', at: 0 });
    const appearance = appearanceWith({
      status: null,
      signal: 'SIGTERM',
      stdout: '',
      error: Object.assign(new Error('spawnSync defaults ETIMEDOUT'), { code: 'ETIMEDOUT' }),
    });
    assert.equal(appearance.takeChange(Date.now()), null);
  });

  test('the key being absent still reads as light', () => {
    // This is the normal light-mode answer, not a failure.
    seed({ value: 'dark', applied: 'dark', at: 0 });
    const appearance = appearanceWith({ status: 1, signal: null, stdout: '' });
    assert.equal(appearance.current(Date.now(), { fresh: true }), 'light');
  });

  test('the key being present still reads as dark', () => {
    seed({ value: 'light', applied: 'light', at: 0 });
    const appearance = appearanceWith({ status: 0, signal: null, stdout: 'Dark\n' });
    assert.equal(appearance.current(Date.now(), { fresh: true }), 'dark');
  });
}
