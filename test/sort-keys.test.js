'use strict';

// The sort keys a pane publishes are rewritten whenever any of them moves.
//
// `tab_key` follows the busiest pane in its tab, so it can change while this
// pane's own `sort_key` and `ws_key` stay put. When only those two decided the
// rewrite, Herdr sorted by a stale `tab_key` while the group furniture was
// drawn for the fresh one: in a workspace with two tabs, the spacer landed
// under the first tab's row and the second tab's row sat against the next
// group's header.

const test = require('node:test');
const assert = require('node:assert/strict');

const herdr = require('../lib/herdr');
const { Frame } = require('../lib/frame');

const entry = { pane: 'w:p1', workspace: 'w', tab: 't', name: 'claude', title: 'x' };

function keysWith(tabKey) {
  return {
    minuteKey: () => '000000000001',
    wsKeys: new Map([['w', 'ws']]),
    tabKeys: new Map([['w:p1', tabKey]]),
  };
}

async function publish(frame, tabKey) {
  const jobs = [];
  frame.paneJobs(entry, 'idle', { tabs: new Map(), keys: keysWith(tabKey), indent: '', spinStep: 0 }, 0, [], jobs);
  await Promise.all(jobs);
}

test('a tab_key that moves on its own is republished', async (t) => {
  const sent = [];
  t.mock.method(herdr, 'reportMetadataAsync', async (_pane, _source, tokens) => {
    if ('tab_key' in tokens) sent.push(tokens.tab_key);
    return true;
  });
  t.mock.method(herdr, 'reportMetadata', () => true);
  const frame = new Frame('test');
  await publish(frame, '0-000000000001-t');
  await publish(frame, '0-000000000002-t');
  assert.deepEqual(sent, ['0-000000000001-t', '0-000000000002-t'], 'the second tab_key was never written');
});

test('unchanged keys are not written again', async (t) => {
  const sent = [];
  t.mock.method(herdr, 'reportMetadataAsync', async (_pane, _source, tokens) => {
    if ('tab_key' in tokens) sent.push(tokens.tab_key);
    return true;
  });
  t.mock.method(herdr, 'reportMetadata', () => true);
  const frame = new Frame('test');
  await publish(frame, '0-000000000001-t');
  await publish(frame, '0-000000000001-t');
  assert.deepEqual(sent, ['0-000000000001-t']);
});
