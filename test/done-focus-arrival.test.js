'use strict';

// The done tick is held until the pane is looked at, and Herdr's `focused`
// flag is how the plugin knows it was. That flag is per server. With a saved
// SSH machine attached, the server the client has left keeps reporting its
// last pane as focused — it is never told the client moved to a pane on the
// other machine. Taking the bare flag as "seen" meant the last-visited pane
// of every machine dropped its tick the instant the turn ended, because the
// stale flag was already there. Only a focus that *arrives* after the turn
// ended is an acknowledgement; one that was already set is ignored.

const test = require('node:test');
const assert = require('node:assert/strict');

const activity = require('../lib/activity');
const config = require('../lib/config');
const herdr = require('../lib/herdr');
const { Frame } = require('../lib/frame');

const PANE = 'w:p1';

// Stamps and recovery are stubbed so nothing reads the real state directory,
// and the two settings this behaviour rides on are pinned.
function paneFrame(t) {
  t.mock.method(activity, 'load', () => new Map());
  t.mock.method(activity, 'save', () => {});
  t.mock.method(activity, 'recover', () => null);
  const hold = config.doneHoldUntilSeen;
  const grace = config.idleGraceMs;
  config.doneHoldUntilSeen = true;
  config.idleGraceMs = 0;
  t.after(() => {
    config.doneHoldUntilSeen = hold;
    config.idleGraceMs = grace;
  });
  return new Frame('test');
}

function entry(overrides = {}) {
  return {
    pane: PANE,
    workspace: 'w',
    tab: 'w:t1',
    name: 'claude',
    title: 'Wire retry budget into dispatcher',
    status: 'idle',
    focused: false,
    ...overrides,
  };
}

// One turn: a frame that sees the agent working, then a frame that sees it
// idle. `focused` is what each frame reported for the pane.
function finishTurn(frame, { focusedWhileWorking, focusedWhenDone }) {
  frame.displayFor(entry({ status: 'working', focused: focusedWhileWorking }), 1000, []);
  return frame.displayFor(entry({ status: 'idle', focused: focusedWhenDone }), 2000, []);
}

test('a stale focused flag does not clear the tick when the turn ends', (t) => {
  const frame = paneFrame(t);

  const display = finishTurn(frame, { focusedWhileWorking: true, focusedWhenDone: true });

  assert.equal(display, 'done', 'the tick was dropped on a focus that was there before the turn ended');
  assert.equal(frame.displayFor(entry({ focused: true }), 3000, []), 'done', 'the tick did not hold on later frames');
});

test('a focus that arrives after the turn ended clears the tick', (t) => {
  const frame = paneFrame(t);

  assert.equal(finishTurn(frame, { focusedWhileWorking: false, focusedWhenDone: false }), 'done');
  assert.equal(frame.displayFor(entry({ focused: false }), 3000, []), 'done', 'the tick did not hold while unfocused');

  const display = frame.displayFor(entry({ focused: true }), 4000, []);

  assert.notEqual(display, 'done', 'looking at the pane did not acknowledge the tick');
  assert.equal(frame.doneUntil.has(PANE), false, 'the hold was left behind after the look');
});

test('leaving and coming back acknowledges a tick that survived a stale flag', (t) => {
  const frame = paneFrame(t);

  assert.equal(finishTurn(frame, { focusedWhileWorking: true, focusedWhenDone: true }), 'done');
  assert.equal(frame.displayFor(entry({ focused: false }), 3000, []), 'done', 'leaving the pane cleared the tick');

  const display = frame.displayFor(entry({ focused: true }), 4000, []);

  assert.notEqual(display, 'done', 'coming back to the pane did not acknowledge the tick');
});

test('the next turn clears a tick on a pane that stayed focused', (t) => {
  const frame = paneFrame(t);

  assert.equal(finishTurn(frame, { focusedWhileWorking: true, focusedWhenDone: true }), 'done');

  const display = frame.displayFor(entry({ status: 'working', focused: true }), 3000, []);

  assert.equal(display, 'working');
  assert.equal(frame.doneUntil.has(PANE), false, 'the old tick outlived the next turn');
});

test('a closed pane takes its focus memory with it', async (t) => {
  // clearGone forgets a pane it has painted; the write it issues is stubbed.
  t.mock.method(herdr, 'reportMetadataAsync', async () => true);
  const frame = paneFrame(t);
  finishTurn(frame, { focusedWhileWorking: true, focusedWhenDone: true });
  assert.equal(frame.wasFocused.get(PANE), true);
  frame.lastLine.set(PANE, 'painted');

  const jobs = [];
  frame.clearGone(new Set(), 5000, jobs);
  await Promise.all(jobs);

  assert.equal(frame.wasFocused.has(PANE), false, 'focus memory leaked past the pane');
});
