'use strict';

// A pane moved to another workspace is not a pane that closed.
//
// `pane.move` gives the pane a new id, and Herdr keeps resolving the old id to
// the same pane. Clearing the old id as a closed pane wiped the tokens off the
// live one; only the tokens that kept changing were written again, so the
// moved row lost its logo and, when idle, its title — a bare ring under the
// group header. The terminal id survives the move, and is what tells the two
// apart. The IPC call is replaced here; nothing reaches a real Herdr.

const test = require('node:test');
const assert = require('node:assert/strict');

const activity = require('../lib/activity');
const herdr = require('../lib/herdr');
const view = require('../lib/view');
const { Frame } = require('../lib/frame');

const keys = {
  minuteKey: () => '000000000001',
  wsKeys: new Map(),
  tabKeys: new Map(),
};

function agentEntry(pane, terminal) {
  return {
    pane,
    terminal,
    workspace: 'w0',
    tab: `${pane}:t`,
    name: 'codex',
    title: 'Migrate invoices table',
    status: 'idle',
  };
}

// A frame that has painted `w12:p1`, running in terminal `term_a`.
function paintedFrame() {
  const frame = new Frame('test');
  frame.terminals.set('w12:p1', 'term_a');
  frame.lastLine.set('w12:p1', 'painted');
  frame.lastTokens.set('w12:p1', { title_idle: 'Migrate invoices table' });
  frame.lastLogo.set('w12:p1', 'logo');
  frame.lastWorkingAt.set('w12:p1', 1000);
  frame.doneUntil.set('w12:p1', 6000);
  frame.previous.set('w12:p1', 'idle');
  frame.blockedSince.set('w12:p1', 2000);
  frame.blockedHeldWork.set('w12:p1', true);
  return frame;
}

// Every test records its writes and keeps the activity stamps in memory: a
// Frame loads them from the plugin's real state directory otherwise.
function record(t) {
  const sent = [];
  t.mock.method(herdr, 'reportMetadataAsync', async (pane, _source, tokens) => {
    sent.push([pane, tokens]);
    return true;
  });
  t.mock.method(herdr, 'reportMetadata', () => true);
  t.mock.method(activity, 'load', () => new Map());
  t.mock.method(activity, 'save', () => {});
  return sent;
}

function writtenTo(sent, pane) {
  return Object.assign({}, ...sent.filter(([target]) => target === pane).map(([, tokens]) => tokens));
}

test('a moved pane is not cleared under its old id', async (t) => {
  const sent = record(t);
  const frame = paintedFrame();
  const entry = agentEntry('w0:p2', 'term_a');

  frame.followMoves([entry], 5000);
  const jobs = [];
  frame.clearGone(new Set([entry.pane]), 5000, jobs);
  await Promise.all(jobs);

  assert.deepEqual(
    sent.filter(([pane]) => pane === 'w12:p1'),
    [],
    'the old id was cleared, and Herdr resolves it to the moved pane',
  );
  assert.equal(frame.lastLine.has('w12:p1'), false, 'the old id is still tracked');
});

test('a moved pane keeps what the frame remembered about it', (t) => {
  record(t);
  const frame = paintedFrame();

  frame.followMoves([agentEntry('w0:p2', 'term_a')], 5000);

  assert.equal(frame.lastWorkingAt.get('w0:p2'), 1000, 'the last turn was lost, so the row shades as never worked');
  assert.equal(frame.doneUntil.get('w0:p2'), 6000, 'the held done badge was dropped or lost its expiry');
  assert.equal(frame.blockedSince.get('w0:p2'), 2000, 'the unanswered question was dropped');
  assert.equal(frame.blockedHeldWork.get('w0:p2'), true);
  assert.equal(frame.previous.get('w0:p2'), 'idle');
  for (const [name, map] of Object.entries({
    lastWorkingAt: frame.lastWorkingAt,
    doneUntil: frame.doneUntil,
    blockedSince: frame.blockedSince,
    blockedHeldWork: frame.blockedHeldWork,
    previous: frame.previous,
  })) {
    assert.equal(map.has('w12:p1'), false, `${name} still holds the old id`);
  }
});

// The pane carried its tokens along, but what it carried is not this frame's
// business: the first write under the new id is the whole set, not a delta
// against what the old id was last sent.
test('a moved pane is repainted in full under its new id', async (t) => {
  const sent = record(t);
  const frame = paintedFrame();
  const entry = agentEntry('w0:p2', 'term_a');

  frame.followMoves([entry], 5000);
  const jobs = [];
  frame.paneJobs(entry, 'idle', { tabs: new Map(), keys, indent: '', spinStep: 0 }, 5000, [], jobs);
  await Promise.all(jobs);

  const written = writtenTo(sent, 'w0:p2');
  assert.ok(written.logo, "the row's logo was not written to the new id");
  assert.ok(written.title_idle, "the row's title was not written to the new id");
});

test('a stamp left under the new id gives way to the moved pane', (t) => {
  record(t);

  const stamped = paintedFrame();
  stamped.lastWorkingAt.set('w0:p2', 1);
  stamped.followMoves([agentEntry('w0:p2', 'term_a')], 5000);
  assert.equal(stamped.lastWorkingAt.get('w0:p2'), 1000, "another pane's stamp outranked the moved pane's own");

  const unstamped = paintedFrame();
  unstamped.lastWorkingAt.delete('w12:p1');
  unstamped.lastWorkingAt.set('w0:p2', 1);
  unstamped.followMoves([agentEntry('w0:p2', 'term_a')], 5000);
  assert.equal(unstamped.lastWorkingAt.has('w0:p2'), false, "a pane that never worked took another pane's stamp");
});

test('a pane whose terminal is gone is still cleared', async (t) => {
  const sent = record(t);
  const frame = paintedFrame();

  frame.followMoves([agentEntry('w0:p2', 'term_b')], 5000);
  const jobs = [];
  frame.clearGone(new Set(['w0:p2']), 5000, jobs);
  await Promise.all(jobs);

  assert.ok(
    sent.some(([pane]) => pane === 'w12:p1'),
    'a closed pane was left with its tokens',
  );
  assert.equal(frame.lastWorkingAt.has('w0:p2'), false, 'a new pane inherited a closed one');
});

// Three frames through render(), from Herdr's agent list to the pane writes:
// before the move, the move, and the frame after it. The Spaces marks, the
// group furniture and the workspace order are stubbed.
test('frames across a move write to the new id and keep its memory', async (t) => {
  const sent = record(t);
  t.mock.method(activity, 'recover', () => null);
  t.mock.method(view, 'mode', () => null);
  t.mock.method(herdr, 'panelGrouped', () => false);
  let agents = [];
  t.mock.method(herdr, 'agentsAsync', async () => agents);
  t.mock.method(herdr, 'tabsAsync', async () => [
    { tab_id: 'w12:t1', label: '1' },
    { tab_id: 'w0:t2', label: '2' },
  ]);
  t.mock.method(herdr, 'workspacesAsync', async () => [
    { workspace_id: 'w12', label: 'billing' },
    { workspace_id: 'w0', label: 'billing' },
  ]);
  const agent = (pane, tab, workspace, status) => ({
    pane_id: pane,
    tab_id: tab,
    workspace_id: workspace,
    terminal_id: 'term_a',
    agent: 'codex',
    agent_status: status,
    terminal_title_stripped: 'Migrate invoices table',
    tokens: {},
  });
  const frame = new Frame('test');
  t.mock.method(frame.workspaceOrder, 'sync', async () => {});
  t.mock.method(frame, 'spaceJobs', () => {});
  t.mock.method(frame, 'groupJobs', async () => {});

  agents = [agent('w12:p1', 'w12:t1', 'w12', 'working')];
  await frame.render(10000);
  sent.length = 0;
  agents = [agent('w0:p2', 'w0:t2', 'w0', 'idle')];
  await frame.render(20000);

  assert.deepEqual(
    sent.filter(([pane]) => pane === 'w12:p1'),
    [],
    'the old id was cleared, and Herdr resolves it to the moved pane',
  );
  const written = writtenTo(sent, 'w0:p2');
  assert.ok(written.logo, "the row's logo was not written to the new id");
  assert.ok(
    Object.keys(written).some((name) => name.startsWith('title_') && written[name]),
    "the row's title was not written to the new id",
  );

  await frame.render(30000);
  assert.equal(frame.lastWorkingAt.get('w0:p2'), 10000, 'a later frame dropped the last turn the pane brought along');
  assert.ok(frame.doneUntil.has('w0:p2'), 'a later frame dropped the done badge the move ended on');
});
