'use strict';

// A write that leaves config.toml unparseable is undone on the spot (#22).
//
// Herdr's `config check` is the judge, replaced here; the files are real,
// in a directory of their own. The exit code is not the verdict: Herdr
// exits 1 for an unknown key it merely ignores, and a file that works must
// not be refused over one.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const herdr = require('../lib/herdr');
const managed = require('../lib/managed-config');

function files(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-checked-write-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'config.toml');
  const saved = path.join(dir, 'config.toml.bak');
  fs.writeFileSync(file, 'before\n');
  fs.copyFileSync(file, saved);
  return { file, saved };
}

const PARSE_ERROR =
  'config: issues found\nconfig parse error: TOML parse error at line 4\nduplicate key `custom`\n; using defaults';

test('a write Herdr cannot parse is restored from the backup', (t) => {
  t.mock.method(herdr, 'configCheck', () => ({ parses: false, ok: false, output: PARSE_ERROR }));
  const { file, saved } = files(t);
  const message = managed.checkedWrite(file, 'after\n', saved);
  assert.equal(fs.readFileSync(file, 'utf8'), 'before\n', 'the broken write was left in place');
  assert.match(message, /duplicate key `custom`/, 'the message does not carry the parser diagnostics');
  assert.doesNotMatch(message, /using defaults/, 'the message carries Herdr boilerplate');
});

test('a write Herdr parses stays, whatever the exit code', (t) => {
  const warning = 'config: issues found\nunknown config key ui.bogus_key; ignoring key';
  t.mock.method(herdr, 'configCheck', () => ({ parses: true, ok: false, output: warning }));
  const { file, saved } = files(t);
  assert.equal(managed.checkedWrite(file, 'after\n', saved), null);
  assert.equal(fs.readFileSync(file, 'utf8'), 'after\n', 'a warning undid the write');
});

test('a parse error is told apart from a warning by the output, not the exit code', () => {
  const check = (output, status) => herdr.configCheck(() => ({ status, stdout: output, stderr: '' }));
  assert.equal(check(PARSE_ERROR, 1).parses, false);
  assert.equal(check('config: issues found\nunknown config key x; ignoring key', 1).parses, true);
  assert.equal(check('config: ok', 0).parses, true);
});
