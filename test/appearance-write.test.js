'use strict';

// The appearance switch rewrites the sidebar block too, so it must be checked
// like every other write. In 1.3.21 it was the one path that wrote unchecked:
// a Spaces row three tokens over Herdr's limit went straight into config.toml,
// Herdr rejected the whole file and every user setting fell back to default.
//
// Herdr's verdict is replaced here, and the plugin's state and Herdr's config
// both live in a directory of their own for this process.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-appearance-'));
process.env.HERDR_RADAR_STATE = path.join(sandbox, 'state');
process.env.XDG_CONFIG_HOME = path.join(sandbox, 'config');

const test = require('node:test');
const assert = require('node:assert/strict');

const herdr = require('../lib/herdr');
const managed = require('../lib/managed-config');

const file = path.join(sandbox, 'config', 'herdr', 'config.toml');
const BEFORE = '[ui]\n\n[theme]\nname = "catppuccin-latte"\n';

test.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

test('an appearance switch Herdr cannot parse is rolled back', (t) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, BEFORE);
  t.mock.method(herdr, 'configCheck', () => ({
    parses: false,
    ok: false,
    output: 'config parse error: sidebar rows may contain at most 16 tokens',
  }));
  const result = managed.applyAppearance('dark');
  assert.equal(result.ok, false, 'a broken write was reported as done');
  assert.equal(fs.readFileSync(file, 'utf8'), BEFORE, 'the broken write was left in place');
});

test('an appearance switch Herdr parses is kept', (t) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, BEFORE);
  t.mock.method(herdr, 'configCheck', () => ({ parses: true, ok: true, output: 'config: ok' }));
  const result = managed.applyAppearance('dark');
  assert.equal(result.ok, true);
  assert.notEqual(fs.readFileSync(file, 'utf8'), BEFORE, 'the switch wrote nothing');
});
