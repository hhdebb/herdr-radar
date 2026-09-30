'use strict';

// The group header carries the machine its sessions run on.
//
// Herdr's own `machine` row token cannot say this: it exists to tell two
// CONNECTED machines apart and Herdr omits it on a client with a single local
// machine (herdr.dev/docs/configuration) — which is exactly the setup where
// this plugin's custom rows replace Herdr's, so the value is never published
// for us to reuse. The plugin publishes its own token instead, and the sidebar
// block renders it as a cell of the header row.
//
// Two things are easy to get wrong here and neither shows up in a unit test
// that only checks the happy path: the machine has to be NULL on every row
// that is not a group head (or a workspace with ten panes spells its machine
// ten times), and an empty `machine_name` has to mean "no machine" rather than
// "fall back to the default" — otherwise there is no way to turn the label
// off. Both are asserted below.

const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../lib/config');
const herdr = require('../lib/herdr');
const state = require('../lib/state');

const ENTRIES = [
  { pane: 'w1:p1', workspace: 'w1' },
  { pane: 'w1:p2', workspace: 'w1' },
  { pane: 'w2:p1', workspace: 'w2' },
];
const LABELS = new Map([
  ['w1', 'meshnote'],
  ['w2', 'terlido'],
]);

// Collect what each pane was told, keyed by pane id.
async function publish(t, machine) {
  const sent = new Map();
  t.mock.method(herdr, 'reportMetadataAsync', async (pane, _source, tokens) => {
    sent.set(pane, tokens);
    return true;
  });
  const previous = config.machineName;
  config.machineName = machine;
  try {
    await state.writeGroups('test', ENTRIES, LABELS);
  } finally {
    config.machineName = previous;
  }
  return sent;
}

test('only a group head carries the machine', async (t) => {
  const sent = await publish(t, 'Asus-PC');
  assert.equal(sent.get('w1:p1').group_machine, 'Asus-PC', 'the head lost its machine');
  assert.equal(sent.get('w1:p2').group_machine, null, 'a member of the group spelled the machine again');
  assert.equal(sent.get('w2:p1').group_machine, 'Asus-PC');
});

test('the group label keeps its own shape, without the machine welded in', async (t) => {
  const sent = await publish(t, 'Asus-PC');
  assert.equal(sent.get('w1:p1').group, 'meshnote', 'the machine was welded into the label instead of a cell');
});

test('an empty machine_name drops the cell instead of falling back', async (t) => {
  const sent = await publish(t, '');
  for (const [pane, tokens] of sent) {
    assert.equal(tokens.group_machine, null, `${pane} still carried a machine with machine_name empty`);
  }
  assert.equal(sent.get('w1:p1').group, 'meshnote', 'the header itself changed when the machine was turned off');
});

test('a rename republishes every header', async (t) => {
  const before = await publish(t, 'Asus-PC');
  const after = await publish(t, 'studio');
  assert.equal(before.get('w1:p1').group_machine, 'Asus-PC');
  assert.equal(after.get('w1:p1').group_machine, 'studio');
  assert.equal(after.get('w2:p1').group_machine, 'studio');
});

test('a stale group carries the machine only on its fader', async (t) => {
  const seen = new Map();
  t.mock.method(herdr, 'reportMetadataAsync', async (pane, _source, tokens) => {
    seen.set(pane, tokens);
    return true;
  });
  // Every session in w1 idle_stale; w2 untouched.
  await state.writeGroups('test', ENTRIES, LABELS, new Set(['w1']));
  const stale = seen.get('w1:p1');
  assert.equal(stale.group_stale, 'meshnote');
  assert.equal(stale.group, null, 'a stale group wrote a live header');
  assert.equal(stale.group_machine, null, 'a stale group wrote a bright machine beside a faded name');
  assert.equal(stale.group_machine_stale, config.machineName, 'the machine did not fade with the name');
  // The live group is untouched, so the fader is not simply always on.
  const live = seen.get('w2:p1');
  assert.equal(live.group_machine_stale, null, 'a live group was faded');
  assert.equal(live.group_machine, config.machineName);
});

test('clearing the groups clears the machine with them', async (t) => {
  const sent = [];
  t.mock.method(herdr, 'reportMetadataAsync', async (pane, _source, tokens) => {
    sent.push([pane, tokens]);
    return true;
  });
  await state.clearGroups('test', ENTRIES);
  assert.equal(sent.length, ENTRIES.length);
  for (const [pane, tokens] of sent) {
    assert.equal(tokens.group_machine, null, `${pane} kept a machine after the groups were taken down`);
    assert.equal(tokens.group_machine_stale, null, `${pane} kept a stale machine after the groups were taken down`);
  }
});
