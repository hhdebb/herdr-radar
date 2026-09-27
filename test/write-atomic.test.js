'use strict';

// writeAtomic writes through a symlink rather than over it.
//
// A config kept in a dotfiles repo is linked into ~/.config. Renaming a temp
// file over the link's path replaces the link with a plain file, so the first
// settings save or `configure` quietly detached the config from the repo.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { writeAtomic } = require('../lib/toml-blocks');

function dir(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-write-atomic-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

test('a symlinked config stays a symlink, and its target gets the text', (t) => {
  const d = dir(t);
  const real = path.join(d, 'dotfiles-config.toml');
  const link = path.join(d, 'config.toml');
  fs.writeFileSync(real, 'old\n');
  fs.symlinkSync(real, link);
  writeAtomic(link, 'new\n');
  assert.ok(fs.lstatSync(link).isSymbolicLink(), 'the link was replaced by a plain file');
  assert.equal(fs.readFileSync(real, 'utf8'), 'new\n');
});

test('a plain config is written in place', (t) => {
  const d = dir(t);
  const file = path.join(d, 'config.toml');
  fs.writeFileSync(file, 'old\n');
  writeAtomic(file, 'new\n');
  assert.ok(!fs.lstatSync(file).isSymbolicLink());
  assert.equal(fs.readFileSync(file, 'utf8'), 'new\n');
});

test('a config that does not exist yet is created', (t) => {
  const file = path.join(dir(t), 'config.toml');
  writeAtomic(file, 'new\n');
  assert.equal(fs.readFileSync(file, 'utf8'), 'new\n');
});
