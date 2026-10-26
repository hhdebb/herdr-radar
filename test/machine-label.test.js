'use strict';

// Herdr shows sessions from saved SSH machines in one panel, and nothing on
// the plugin's rows said which machine a session was on. A workspace never
// spans machines, so `multi_machine` names the machine once, on the outermost
// header of each family: `web · Machine-One`. Off, the headers are what they were.

const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../lib/config');
const herdr = require('../lib/herdr');
const state = require('../lib/state');

const entries = ['app', 'feature', 'hotfix', 'other'].map((ws) => ({
  pane: `${ws}:p1`,
  workspace: ws,
  tab: `${ws}:t1`,
  name: 'claude',
  title: 'x',
}));

async function groupsFor(t, label, list = entries, tree = {}) {
  const before = config.machineLabel;
  config.machineLabel = label;
  t.after(() => {
    config.machineLabel = before;
  });
  const sent = new Map();
  t.mock.method(herdr, 'reportMetadataAsync', async (pane, _source, tokens) => {
    sent.set(pane, tokens);
    return true;
  });
  const labels = new Map(list.map((entry) => [entry.workspace, entry.workspace]));
  await state.writeGroups('test', list, labels, new Set(), tree);
  return sent;
}

test('off: headers are the workspace names alone', async (t) => {
  const sent = await groupsFor(t, '');
  assert.equal(sent.get('app:p1').group, 'app');
  assert.equal(sent.get('other:p1').group, 'other');
});

test('on: top-level headers carry the machine, nested worktrees do not', async (t) => {
  const sent = await groupsFor(t, 'Machine-One', entries, {
    detached: new Set(['hotfix']),
    parentOf: new Map([
      ['feature', 'app'],
      ['hotfix', 'app'],
    ]),
  });
  assert.equal(sent.get('app:p1').group, 'app · Machine-One');
  assert.equal(sent.get('other:p1').group, 'other · Machine-One');
  assert.doesNotMatch(sent.get('feature:p1').group, /Machine-One/, 'a worktree under its repo repeats nothing');
  assert.match(sent.get('hotfix:p1').group, /hotfix · Machine-One$/, 'a detached worktree stands at the top level');
});

test('on: an orphan worktree names the machine on its repo row', async (t) => {
  const list = entries.filter((entry) => entry.workspace === 'feature');
  const sent = await groupsFor(t, 'Machine-Two', list, {
    parentOf: new Map([['feature', 'app']]),
    orphanRepo: new Map([['feature', 'app']]),
  });
  assert.equal(sent.get('feature:p1').group_parent, 'app · Machine-Two');
  assert.doesNotMatch(sent.get('feature:p1').group, /Machine-Two/);
});

// The switch is the whole feature: off, a label left in the file changes
// nothing, so a single-machine setup is what it always was.
test('multi_machine gates the label, and an empty label is the hostname', (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-machine-'));
  const before = process.env.HERDR_PLUGIN_CONFIG_DIR;
  t.after(() => {
    if (before === undefined) delete process.env.HERDR_PLUGIN_CONFIG_DIR;
    else process.env.HERDR_PLUGIN_CONFIG_DIR = before;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  process.env.HERDR_PLUGIN_CONFIG_DIR = dir;
  const load = (text) => {
    fs.writeFileSync(path.join(dir, 'config.toml'), text);
    const file = require.resolve('../lib/config');
    delete require.cache[file];
    try {
      return require(file);
    } finally {
      delete require.cache[file];
    }
  };

  assert.equal(load('machine_label = "Machine-One"').machineLabel, '', 'a label without the switch must not show');
  assert.equal(
    load(['multi_machine = true', 'machine_label = "Machine-One"'].join(os.EOL)).machineLabel,
    'Machine-One',
  );
  assert.equal(load('multi_machine = true').machineLabel, os.hostname().split('.')[0]);
});
