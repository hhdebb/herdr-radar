'use strict';

// `[extra_space_row]` is `[extra_row]` for the Spaces panel. Workspace tokens
// another plugin publishes (`$project`, say) are drawn by `[ui.sidebar.spaces]`,
// which Herdr also takes once and Radar writes inside its markers, so a plugin
// cannot add a Spaces row without making that table foreign. Same flat shape,
// same rules: token name without the `$`, `#rrggbb`, file order is cell order.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MODULES = ['../lib/config', '../lib/logos', '../lib/managed-config'];

// Same pins as extra-row.test.js, so the golden fixture holds here too.
const PINNED_AGENTS = ['claude', 'codex', 'gemini'];
const PINNED_CONFIG = 'variant = "text"\n';

function load(toml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-extra-space-row-'));
  fs.writeFileSync(path.join(dir, 'config.toml'), PINNED_CONFIG + (toml ?? ''));
  process.env.HERDR_PLUGIN_CONFIG_DIR = dir;
  const remote = path.join(dir, 'state', 'herdr', 'agent-detection', 'remote');
  fs.mkdirSync(remote, { recursive: true });
  for (const id of PINNED_AGENTS) fs.writeFileSync(path.join(remote, `${id}.toml`), '');
  process.env.XDG_STATE_HOME = path.join(dir, 'state');
  for (const name of MODULES) delete require.cache[require.resolve(name)];
  return { config: require('../lib/config'), managed: require('../lib/managed-config'), dir };
}

test.afterEach(() => {
  delete process.env.HERDR_PLUGIN_CONFIG_DIR;
  delete process.env.XDG_STATE_HOME;
  for (const name of MODULES) delete require.cache[require.resolve(name)];
});

const two = '[extra_space_row]\nproject_icon = "#a8abbd"\nproject = "#d97757"\n';

// The `rows = [...]` value of `[ui.sidebar.spaces]`, up to the block's end.
function spacesRows(block) {
  const from = block.indexOf('[ui.sidebar.spaces]');
  return block.slice(block.indexOf('rows = [', from), block.lastIndexOf(']') + 1);
}

test('without [extra_space_row] the sidebar block is byte-for-byte what 1.4.4 generated', () => {
  const { config, managed } = load(null);
  assert.deepEqual(config.extraSpaceRow(), []);
  const golden = fs.readFileSync(path.join(__dirname, 'fixtures', 'sidebar-block-dark.base.toml'), 'utf8');
  assert.equal(managed.sidebarBlock('dark'), golden);
});

test('extraSpaceRow() keeps the names and colours in file order', () => {
  const { config } = load(two);
  assert.deepEqual(config.extraSpaceRow(), [
    { token: 'project_icon', fg: '#a8abbd' },
    { token: 'project', fg: '#d97757' },
  ]);
});

test('the Spaces rows gain a third row after the logos, and the Agents rows do not', () => {
  const { managed } = load(two);
  const block = managed.sidebarBlock('dark');
  const rows = spacesRows(block);
  const extra =
    '  [\n    { token = "$project_icon", fg = "#a8abbd", bold = false, dim = false },\n' +
    '    { token = "$project", fg = "#d97757", bold = false, dim = false }\n  ]\n]';
  assert.ok(rows.endsWith(extra), rows.slice(-300));
  const agents = block.slice(0, block.indexOf('[ui.sidebar.spaces]'));
  assert.ok(!agents.includes('$project'), 'the Agents panel is [extra_row]’s, not this setting’s');
});

test('a bad name or colour is skipped, and the row stops at sixteen tokens', () => {
  const bad = load('[extra_space_row]\nBad-Name = "#112233"\nproject = "red"\n7 = "#112233"\nok_one = "#112233"\n');
  assert.deepEqual(bad.config.extraSpaceRow(), [{ token: 'ok_one', fg: '#112233' }]);

  const many = Array.from({ length: 20 }, (_, i) => `t${i} = "#0000${i.toString(16).padStart(2, '0')}"`);
  const { config, managed } = load(`[extra_space_row]\n${many.join('\n')}\n`);
  assert.equal(config.extraSpaceRow().length, 16);
  assert.equal(managed.blockOverLimit(`${managed.sidebarBlock('light')}\n`), false);
});

test('both settings together: each panel gets only its own row', () => {
  const { managed } = load(`${two}[extra_row]\nagent_model = "#8b8e9c"\n`);
  const block = managed.sidebarBlock('dark');
  const at = block.indexOf('[ui.sidebar.spaces]');
  assert.ok(block.slice(0, at).includes('$agent_model'));
  assert.ok(!block.slice(at).includes('$agent_model'));
  assert.ok(block.slice(at).includes('$project'));
  assert.deepEqual(managed.foreignTables(`${block}\n`), []);
});
