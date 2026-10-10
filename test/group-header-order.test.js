'use strict';

// The group header is the first pane in the order Herdr gave us — the order
// the sidebar draws — not the most recently active pane. When the panel is
// grouped, `displayOrder` sorts the entries descending by recency; a head
// picked from that order puts the header after the workspace's other panes,
// and they read as part of the previous project group (#49).

const test = require('node:test');
const assert = require('node:assert/strict');

const state = require('../lib/state');
const { Frame } = require('../lib/frame');

test('groupBoundaries picks the first pane in the entries order as the head', () => {
  const entries = [
    { pane: 'w:p1', workspace: 'w' },
    { pane: 'w:p2', workspace: 'w' },
  ];
  const { heads, tails } = state.groupBoundaries(entries);
  assert.deepEqual([...heads], ['w:p1']);
  assert.deepEqual([...tails], ['w:p2']);
});

test('writeGroups puts the group token on the first pane in the entries order', async (t) => {
  const herdr = require('../lib/herdr');
  const sent = new Map();
  t.mock.method(herdr, 'reportMetadataAsync', async (pane, _source, tokens) => {
    sent.set(pane, tokens.group);
    return true;
  });
  const entries = [
    { pane: 'w:p1', workspace: 'w', tab: 't', name: 'claude', title: 'x' },
    { pane: 'w:p2', workspace: 'w', tab: 't', name: 'claude', title: 'x' },
  ];
  const wsLabels = new Map([['w', 'W']]);
  await state.writeGroups('test', entries, wsLabels);
  assert.equal(sent.get('w:p1'), 'W', 'the first pane in herdr order carries the header');
  assert.equal(sent.get('w:p2'), null, 'the other pane has no header');
});

test('groupJobs passes the original entries to writeGroups, not the sorted displayEntries', async (t) => {
  let received;
  t.mock.method(state, 'writeGroups', async (_source, entries) => {
    received = entries;
    return { ok: true };
  });
  t.mock.method(state, 'sweepOrphans', async () => true);
  const entries = [
    { pane: 'w:p1', workspace: 'w', tab: 't', name: 'claude', title: 'x' },
    { pane: 'w:p2', workspace: 'w', tab: 't', name: 'claude', title: 'x' },
  ];
  const displayEntries = [...entries].reverse();
  const frame = new Frame('test');
  await frame.groupJobs(
    entries,
    displayEntries,
    'grouped',
    true,
    new Map([['w', [{ display: 'working', name: 'claude' }]]]),
    new Map([['w', 'W']]),
    { parentOf: new Map(), orphanRepo: new Map() },
    0,
    [],
  );
  assert.equal(received, entries, 'writeGroups received the original entries, not displayEntries');
});
