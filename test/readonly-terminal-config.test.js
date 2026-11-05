'use strict';

// Home Manager links a terminal config into the read-only Nix store, so the
// write that adds the codepoint map fails. It used to throw out of the build
// hook and abort the install, after the managed blocks and the font were
// already in place (#78). A refused file is skipped with a note that carries
// the lines, and the other configs still get their map.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// lib/font.js builds its paths at load, and the macOS one hangs off the home
// directory, so both have to point here or a test writes the real config.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-readonly-'));
process.env.XDG_CONFIG_HOME = path.join(sandbox, 'config');
process.env.HOME = sandbox;
process.env.USERPROFILE = sandbox;

const font = require('../lib/font');

const locked = path.join(sandbox, 'config', 'ghostty', 'config');
const open = path.join(sandbox, 'config', 'kitty', 'kitty.conf');
const ORIGINAL = 'font-size = 12\n';

function seed(text) {
  for (const file of [locked, open]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, 'utf8');
  }
}

function refuseLocked(t) {
  const write = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', (file, ...rest) => {
    if (file === locked) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    return write(file, ...rest);
  });
}

test('a read-only config is skipped with the lines to add, and the others still get the map', (t) => {
  seed(ORIGINAL);
  refuseLocked(t);

  const notes = font.configureTerminals();

  assert.equal(fs.readFileSync(locked, 'utf8'), ORIGINAL);
  assert.match(fs.readFileSync(open, 'utf8'), /symbol_map U\+/);
  const at = notes.findIndex((note) => note.includes(`cannot write ${locked} (EACCES)`));
  assert.notEqual(at, -1, notes.join('\n'));
  assert.match(notes[at + 1], /^ {2}font-codepoint-map = U\+/);
  assert.match(notes[at + 2], /^ {2}font-codepoint-map = U\+/);
  assert.ok(notes.some((note) => note.includes(`written to ${open}`)));
});

test('a read-only config does not read as a terminal with no config at all', (t) => {
  seed(ORIGINAL);
  refuseLocked(t);

  const notes = font.configureTerminals();

  assert.ok(!notes.some((note) => note.includes('no ghostty/kitty config found')));
});

test('removing the map from a read-only config says so and still cleans the others', (t) => {
  seed(ORIGINAL);
  font.configureTerminals();
  const mapped = fs.readFileSync(locked, 'utf8');
  refuseLocked(t);

  const notes = font.unconfigureTerminals();

  assert.equal(fs.readFileSync(locked, 'utf8'), mapped);
  assert.doesNotMatch(fs.readFileSync(open, 'utf8'), /symbol_map/);
  assert.ok(notes.some((note) => note.includes(`cannot write ${locked} (EACCES)`)));
  assert.ok(notes.some((note) => note.includes(`removed from ${open}`)));
});
