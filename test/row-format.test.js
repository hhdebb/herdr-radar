'use strict';

// `row_format`: the row's text as a template (lib/state.js formatRow).
//
// `row_label` offers three fixed layouts; none of them can show a pane's own
// label, and none can put a separator between two names without leaving it
// dangling on the rows that have only one.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const activity = require('../lib/activity');
const config = require('../lib/config');
const herdr = require('../lib/herdr');
const state = require('../lib/state');
const { Frame } = require('../lib/frame');

const fields = { title: 'Fix login', tab: 'qa', pane: 'api', name: '', agent: 'Claude', workspace: 'herdr' };

test('a field is replaced by its value', () => {
  assert.equal(state.formatRow('{pane} · {title}', fields), 'api · Fix login');
});

test('an alternation takes the first field that says anything', () => {
  assert.equal(state.formatRow('{name|pane|title}', fields), 'api');
  assert.equal(state.formatRow('{name|title}', fields), 'Fix login');
});

test('a section is dropped whole when a field in it is empty', () => {
  assert.equal(state.formatRow('[{name}: ]{title}', fields), 'Fix login', 'a separator dangles off an empty field');
  assert.equal(state.formatRow('[{pane}: ]{title}', fields), 'api: Fix login');
});

test('an unknown name stays as written', () => {
  assert.equal(state.formatRow('{nope} {title}', fields), '{nope} Fix login');
});

test('only a real field is a field', () => {
  assert.equal(state.formatRow('{constructor} {title}', fields), '{constructor} Fix login');
});

test('a value is not read as template', () => {
  const tricky = { ...fields, title: 'Fix {pane} [draft]' };
  assert.equal(state.formatRow('[{pane} · ]{title}', tricky), 'api · Fix {pane} [draft]');
});

test('a template only costs the fields it names', () => {
  assert.equal(state.rowFormatUses('[{tab|pane} · ]{title}', 'pane'), true);
  assert.equal(state.rowFormatUses('{title}', 'pane'), false);
  assert.equal(state.rowFormatUses(null, 'pane'), false);
});

test('row_format is read from the settings file, and empty means unset', () => {
  const read = (toml) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-config-'));
    fs.writeFileSync(path.join(dir, 'config.toml'), toml);
    const out = spawnSync(
      process.execPath,
      ['-e', "process.stdout.write(JSON.stringify(require('./lib/config').rowFormat))"],
      { cwd: path.join(__dirname, '..'), env: { ...process.env, HERDR_PLUGIN_CONFIG_DIR: dir }, encoding: 'utf8' },
    );
    fs.rmSync(dir, { recursive: true, force: true });
    return JSON.parse(out.stdout);
  };
  assert.equal(read('row_format = "[{pane} · ]{title}"\n'), '[{pane} · ]{title}');
  assert.equal(read('row_format = ""\n'), null);
  assert.equal(read(''), null);
});

const keys = { minuteKey: () => '000000000001', wsKeys: new Map(), tabKeys: new Map() };
const entry = {
  pane: 'w0:p1',
  workspace: 'w0',
  tab: 'w0:t1',
  name: 'codex',
  agentName: '',
  title: 'Migrate invoices table',
  status: 'idle',
};

async function paintedTitle(t, rowFormat, context) {
  const sent = [];
  t.mock.method(herdr, 'reportMetadataAsync', async (_pane, _source, tokens) => {
    sent.push(tokens);
    return true;
  });
  t.mock.method(activity, 'load', () => new Map());
  t.mock.method(activity, 'save', () => {});
  const before = config.rowFormat;
  config.rowFormat = rowFormat;
  t.after(() => (config.rowFormat = before));

  const jobs = [];
  new Frame('test').paneJobs(
    entry,
    'idle',
    { tabs: new Map([['w0:t1', 'qa']]), keys, indent: '', spinStep: 0, ...context },
    5000,
    [],
    jobs,
  );
  await Promise.all(jobs);
  return Object.assign({}, ...sent).title_idle;
}

test('the row shows the pane label the template asks for', async (t) => {
  const title = await paintedTitle(t, '[{pane} · ]{title}', { paneLabel: 'api' });
  assert.equal(title, 'api · Migrate invoices table');
});

test('a template that comes out empty falls back to the title', async (t) => {
  const title = await paintedTitle(t, '{pane}', {});
  assert.equal(title, 'Migrate invoices table', 'a pane with no label got a blank row');
});

test('pane labels are read only for a template that shows them', async (t) => {
  t.mock.method(herdr, 'tabsAsync', async () => [{ tab_id: 't1', label: '1' }]);
  t.mock.method(herdr, 'workspacesAsync', async () => [{ workspace_id: 'w1', label: 'radar' }]);
  const panes = t.mock.method(herdr, 'panesAsync', async () => [
    { pane_id: 'w1:p1', label: 'api' },
    { pane_id: 'w1:p2' },
  ]);
  const before = config.rowFormat;
  t.after(() => (config.rowFormat = before));

  // Far past the label TTL each time, so no call is answered from the cache.
  config.rowFormat = null;
  await state.labels(1e9);
  assert.equal(panes.mock.callCount(), 0, 'every user pays a pane.list for a field nobody shows');

  config.rowFormat = '[{pane} · ]{title}';
  const labels = await state.labels(2e9);
  assert.deepEqual([...labels.panes], [['w1:p1', 'api']]);

  panes.mock.mockImplementation(async () => []);
  assert.deepEqual([...(await state.labels(3e9)).panes], [['w1:p1', 'api']], 'a failed read dropped every label');
});
