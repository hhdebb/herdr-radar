'use strict';

// `[logos]` and `[logo_colors]` in config.toml (lib/config.js, lib/logos.js).
//
// An agent Herdr reports under a name this plugin has no mark for got no logo
// cell, so its row began at the spinner, two cells left of every other row.
// The user's table gives such an agent a mark without a code change.
//
// The config file is read once, when lib/config.js is first required, so each
// case writes a config.toml into a scratch directory and loads the modules
// afresh against it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LIB = path.join(__dirname, '..', 'lib');
const MODULES = ['config', 'logos', 'managed-config'];

// The modules, loaded against a config.toml holding `toml`.
function load(toml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-logos-'));
  fs.writeFileSync(path.join(dir, 'config.toml'), toml);
  const before = process.env.HERDR_PLUGIN_CONFIG_DIR;
  process.env.HERDR_PLUGIN_CONFIG_DIR = dir;
  for (const name of MODULES) delete require.cache[require.resolve(path.join(LIB, name))];
  try {
    return {
      config: require(path.join(LIB, 'config')),
      logos: require(path.join(LIB, 'logos')),
      managed: require(path.join(LIB, 'managed-config')),
    };
  } finally {
    if (before === undefined) delete process.env.HERDR_PLUGIN_CONFIG_DIR;
    else process.env.HERDR_PLUGIN_CONFIG_DIR = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('a user logo gives an unknown agent a logo cell', () => {
  const { logos } = load('[logos]\nmywrapper = "\\u{F0BA4}"\n');
  assert.equal(logos.logoFor('mywrapper', 'font'), '\u{F0BA4}');
  assert.equal(logos.logoFor('mywrapper', 'text'), '\u{F0BA4}', 'the user chose it, so the text variant uses it too');
  assert.equal(logos.logoFor('mywrapper', 'auto'), '\u{F0BA4}');
  assert.equal(logos.glyphs('font').mywrapper, '\u{F0BA4}');
});

test('a literal glyph and the \\uXXXX form both read as the mark', () => {
  const { logos } = load('[logos]\nliteral = "★"\nbmp = "\\u2605"\n');
  assert.equal(logos.logoFor('literal', 'text'), '★');
  assert.equal(logos.logoFor('bmp', 'text'), '★');
});

test('an unknown agent with no user logo stays unmarked', () => {
  const { logos } = load('[logos]\nmywrapper = "\\u{F0BA4}"\n');
  assert.equal(logos.logoFor('someone-else', 'font'), null);
  assert.equal(logos.logoFor('someone-else', 'text'), null);
  assert.equal('someone-else' in logos.glyphs('font'), false);
  // And with no table at all, nothing has changed for anyone.
  const bare = load('');
  assert.equal(bare.logos.logoFor('mywrapper', 'font'), null);
  assert.deepEqual(bare.logos.glyphs('font'), bare.logos.PUA);
});

test('a user logo for a built-in vendor overrides it, and the others are untouched', () => {
  const { logos } = load('[logos]\nclaude = "C"\n');
  assert.equal(logos.logoFor('claude', 'font'), 'C');
  assert.equal(logos.logoFor('claude', 'text'), 'C');
  assert.equal(logos.logoFor('codex', 'font'), logos.PUA.codex);
  assert.equal(logos.logoFor('codex', 'text'), logos.TEXT.codex);
  assert.equal(logos.glyphs('font').claude, 'C');
});

test('variant none hides user logos as well as built-in ones', () => {
  const { logos } = load('[logos]\nmywrapper = "W"\nclaude = "C"\n');
  assert.equal(logos.logoFor('mywrapper', 'none'), null);
  assert.equal(logos.logoFor('claude', 'none'), null);
  assert.deepEqual(logos.glyphs('none'), {});
});

test('a malformed table is ignored without crashing', () => {
  // `logos` as a scalar, an array-ish value, and a table of junk entries.
  for (const toml of [
    'logos = "oops"\n',
    'logos = 3\n',
    'logos = [1, 2]\n',
    '[logos]\n',
    '[logos]\n= "x"\nbad\nempty = ""\nblank = "   "\nnum = 5\nflag = true\n',
  ]) {
    const { logos } = load(toml);
    assert.equal(logos.logoFor('empty', 'font'), null, toml);
    assert.equal(logos.logoFor('num', 'font'), null, toml);
    assert.equal(logos.logoFor('claude', 'font'), logos.PUA.claude, toml);
    assert.deepEqual(logos.glyphs('font'), logos.PUA, toml);
  }
});

test('one bad entry does not take the good ones down', () => {
  const { logos } = load('[logos]\nbad = ""\ngood = "G"\nnum = 5\n');
  assert.equal(logos.logoFor('good', 'font'), 'G');
  assert.equal(logos.logoFor('bad', 'font'), null);
});

test('an agent id that is an Object.prototype name is not given a mark', () => {
  const { logos } = load('[logos]\nmywrapper = "W"\n');
  assert.equal(logos.logoFor('constructor', 'text'), null);
  assert.equal(logos.logoFor('toString', 'font'), null);
});

test('logo_colors only takes hex colours, and a malformed table is ignored', () => {
  const { config } = load('[logo_colors]\nmywrapper = "#aabbcc"\nbad = "red"\nquote = "#aa\\"bb"\nnum = 4\n');
  assert.deepEqual(config.userLogoColors, { mywrapper: '#aabbcc' });
  assert.deepEqual(load('logo_colors = "x"\n').config.userLogoColors, {});
});

test('the sidebar block colours a user logo by rule, and only when asked', () => {
  const { managed } = load('[logos]\nmywrapper = "W"\nplain = "P"\n[logo_colors]\nmywrapper = "#aabbcc"\n');
  const rule = managed.sidebarBlock('dark');
  assert.match(rule, /\{ contains = "W", fg = "#aabbcc" \}/);
  assert.doesNotMatch(rule, /contains = "P"/, 'no colour set, so the plain ink applies');
});

test('the block records a fingerprint of the user logos, and none without any', () => {
  const none = load('');
  assert.equal(none.managed.logosFingerprint(), null);
  assert.doesNotMatch(none.managed.sidebarBlock('dark'), /# user logos:/);

  const a = load('[logos]\nmywrapper = "W"\n');
  const b = load('[logos]\nmywrapper = "X"\n');
  const fpA = a.managed.logosFingerprint();
  assert.ok(fpA);
  assert.notEqual(fpA, b.managed.logosFingerprint(), 'editing a mark must make the block stale');
  assert.equal(a.managed.blockLogos(a.managed.sidebarBlock('dark')), fpA);
});
