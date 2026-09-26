'use strict';

// The label cache must survive a failed read.
//
// `workspacesAsync` answers `[]` both for a timed-out call and for a session
// with nothing open, so `labels()` treats an empty list as the failure it
// almost always is. Committing one would blank every group header to a bare
// id, then redraw them all on the next good read; with the header fingerprint
// sensitive to labels, a flapping socket would rewrite the whole panel on each
// swing. The guard is one condition — exactly the shape that gets tidied away —
// so the real module is driven with its two reads replaced.

const test = require('node:test');
const assert = require('node:assert/strict');

const herdr = require('../lib/herdr');
const state = require('../lib/state');

// Every call reads well past the label TTL, so none is answered from the cache
// by accident. The cache is module state and outlives each test in this file.
let now = 0;
const later = () => (now += 60000);

const TABS = async () => [{ tab_id: 't1', label: '1' }];
const listing = (label) => async () => [{ workspace_id: 'w1', label }];

test('a good read labels the workspace', async (t) => {
  t.mock.method(herdr, 'tabsAsync', TABS);
  t.mock.method(herdr, 'workspacesAsync', listing('radar'));
  assert.equal((await state.labels(later())).workspaces.get('w1'), 'radar');
});

test('an empty workspace list keeps the cached labels', async (t) => {
  t.mock.method(herdr, 'tabsAsync', TABS);
  t.mock.method(herdr, 'workspacesAsync', listing('radar'));
  await state.labels(later());
  herdr.workspacesAsync.mock.mockImplementation(async () => []);
  const after = await state.labels(later());
  assert.equal(after.workspaces.get('w1'), 'radar', 'a failed read replaced every label — headers fall back to ids');
});

test('a failed read waits out the TTL instead of asking every frame', async (t) => {
  t.mock.method(herdr, 'tabsAsync', TABS);
  t.mock.method(herdr, 'workspacesAsync', listing('radar'));
  await state.labels(later());
  herdr.workspacesAsync.mock.mockImplementation(async () => []);
  const failedAt = later();
  herdr.workspacesAsync.mock.resetCalls();
  await state.labels(failedAt);
  await state.labels(failedAt + 1);
  assert.equal(herdr.workspacesAsync.mock.callCount(), 1, 'a failing read was retried inside one TTL');
});

test('a good read after a failed one still lands', async (t) => {
  t.mock.method(herdr, 'tabsAsync', TABS);
  t.mock.method(herdr, 'workspacesAsync', async () => []);
  await state.labels(later());
  herdr.workspacesAsync.mock.mockImplementation(listing('renamed'));
  assert.equal((await state.labels(later())).workspaces.get('w1'), 'renamed');
});
