'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../lib/config');
const herdr = require('../lib/herdr');
const state = require('../lib/state');
const { Frame, splitTreeCorner } = require('../lib/frame');

test('zero indent keeps headers, gaps, and worktree marks without corners', async (t) => {
  const sent = [];
  const previousMark = config.worktreeMark;
  config.worktreeMark = '*';
  t.after(() => {
    config.worktreeMark = previousMark;
  });
  t.mock.method(herdr, 'reportMetadataAsync', async (pane, _source, tokens) => {
    sent.push([pane, tokens]);
    return true;
  });

  const entries = [
    { workspace: 'checkout', pane: 'checkout:p1' },
    { workspace: 'worktree', pane: 'worktree:p1' },
  ];
  const labels = new Map(entries.map((entry) => [entry.workspace, entry.workspace]));
  await state.writeGroups('test', entries, labels, new Set(), {
    parentOf: new Map([['worktree', 'checkout']]),
    indent: '',
  });

  const worktree = sent.find(([pane]) => pane === 'worktree:p1')[1];
  assert.equal(worktree.group, '* worktree');
  assert.equal(worktree.gap, '\u200b');
  assert.equal(sent.find(([pane]) => pane === 'checkout:p1')[1].group, 'checkout');
});

test('zero indent still writes grouped furniture', async (t) => {
  const previousIndent = state.INDENT;
  state.INDENT = '';
  t.after(() => {
    state.INDENT = previousIndent;
  });
  const calls = [];
  t.mock.method(state, 'writeGroups', async () => {
    calls.push('groups');
    return { ok: true };
  });
  t.mock.method(state, 'clearGroups', async () => {
    calls.push('clear');
    return { ok: true };
  });
  t.mock.method(state, 'sweepOrphans', async () => true);

  const entries = [{ workspace: 'checkout', pane: 'checkout:p1' }];
  const frame = new Frame('test');
  await frame.groupJobs(
    entries,
    entries,
    null,
    true,
    new Map(),
    new Map([['checkout', 'checkout']]),
    {
      parentOf: new Map(),
      orphanRepo: new Map(),
    },
    0,
    [],
  );
  assert.deepEqual(calls, ['groups']);
});

test('zero indent removes split corners', () => {
  assert.equal(splitTreeCorner(true, true, false, true, false), '');
  assert.equal(splitTreeCorner(true, true, true, true, false), '├─ ');
});
