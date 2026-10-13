'use strict';

// `[extra_row]` lets another plugin put a row in Radar's sidebar table. Herdr
// takes one `[ui.sidebar.agents]` table, so a plugin that publishes tokens of
// its own cannot add a row without writing the table itself, and a table the
// user holds outside our markers is "foreign" — Radar then leaves its own
// block out. The setting keeps the table ours and the extra cells inside it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MODULES = ['../lib/config', '../lib/managed-config'];

// config.js reads its file once, at require time, so every case starts from a
// clean module cache and a config directory of its own.
function load(toml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-extra-row-'));
  if (toml !== null) fs.writeFileSync(path.join(dir, 'config.toml'), toml);
  process.env.HERDR_PLUGIN_CONFIG_DIR = dir;
  for (const name of MODULES) delete require.cache[require.resolve(name)];
  return { config: require('../lib/config'), managed: require('../lib/managed-config'), dir };
}

test.afterEach(() => {
  delete process.env.HERDR_PLUGIN_CONFIG_DIR;
  for (const name of MODULES) delete require.cache[require.resolve(name)];
});

const GREY = '#8b8e9c';
const two = `[extra_row]\nagent_model = "${GREY}"\nagent_mem = "#aabbcc"\n`;

// Every `rows = [...]` / `<vendor> = [...]` body in the block, as the rows
// topLevelRows would split it.
function agentRows(block) {
  const lines = block.split('\n').filter((l) => /^(rows|\w+) = \[\[/.test(l));
  return lines;
}

test('without [extra_row] the sidebar block is byte-for-byte what 1.4.4 generated', () => {
  const { config, managed } = load(null);
  assert.deepEqual(config.extraRow(), []);
  // Generated once from dd42772 (before this setting existed). An empty extra
  // row, or any stray cell, shows up here; comparing two runs of the new code
  // could not see it.
  const golden = fs.readFileSync(path.join(__dirname, 'fixtures', 'sidebar-block-dark.base.toml'), 'utf8');
  assert.equal(managed.sidebarBlock('dark'), golden);
  for (const row of agentRows(golden)) assert.ok(row.endsWith('], ["$gap"]]'), row.slice(-120));
});

test('extraRow() keeps the names and colours in file order', () => {
  const { config } = load(two);
  assert.deepEqual(config.extraRow(), [
    { token: 'agent_model', fg: GREY },
    { token: 'agent_mem', fg: '#aabbcc' },
  ]);
});

test('every agent row list carries the extra row just before the gap', () => {
  const { managed } = load(two);
  const block = managed.sidebarBlock('dark');
  const extra = `[{ token = "$agent_model", fg = "${GREY}", bold = false, dim = false }, { token = "$agent_mem", fg = "#aabbcc", bold = false, dim = false }], ["$gap"]]`;
  const rows = agentRows(block);
  assert.ok(rows.length > 1, 'the fallback list and the per-vendor lists');
  for (const row of rows) assert.ok(row.endsWith(extra), row.slice(-200));
});

test('a bad name or colour is skipped, and the row stops at sixteen tokens', () => {
  const bad = load(
    '[extra_row]\nBad-Name = "#112233"\nagent_model = "red"\nagent_ctx_ok = "#12345"\n7 = "#112233"\nok_one = "#112233"\n',
  );
  assert.deepEqual(bad.config.extraRow(), [{ token: 'ok_one', fg: '#112233' }]);

  const many = Array.from({ length: 20 }, (_, i) => `t${i} = "#0000${i.toString(16).padStart(2, '0')}"`);
  const { config, managed } = load(`[extra_row]\n${many.join('\n')}\n`);
  assert.equal(config.extraRow().length, 16);
  assert.deepEqual(config.extraRow()[15], { token: 't15', fg: '#00000f' });
  // Herdr refuses the config over a row of seventeen, so the block must not be one.
  assert.equal(managed.blockOverLimit(`${managed.sidebarBlock('light')}\n`), false);
});

test('the table stays Radar’s own: nothing is foreign', () => {
  const { managed } = load(two);
  const text = `${managed.sidebarBlock('dark')}\n`;
  assert.deepEqual(managed.foreignTables(text), []);
});
