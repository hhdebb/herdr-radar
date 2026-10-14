'use strict';

// The `fixed` order: grouped like `active`, but nothing moves with activity.
//
// Herdr appends a worktree opened later to the end of its workspace list, so
// in Herdr's own order (`off`) a worktree can sit under an unrelated project
// while still drawn with a corner (#54). `fixed` keeps each family together,
// parent first, and otherwise keeps Herdr's order: a family ranks by where its
// root sits in Herdr's list, and inside it Herdr's own workspace, tab and pane
// order decide. Activity plays no part.

const test = require('node:test');
const assert = require('node:assert/strict');

const view = require('../lib/view');
const { Frame } = require('../lib/frame');

function entry(pane, workspace) {
  return { pane, workspace, tab: `${workspace}:t1`, name: 'claude', title: pane };
}

// Herdr's order: app, app.feature, other, app.hotfix, scratch.
const entries = [
  entry('app:p1', 'app'),
  entry('feat:p1', 'feat'),
  entry('other:p1', 'other'),
  entry('hotfix:p1', 'hotfix'),
  entry('scratch:p1', 'scratch'),
];
const parents = new Map([
  ['feat', 'app'],
  ['hotfix', 'app'],
]);

test('fixed keeps a worktree family together, parent first, in Herdr order', () => {
  const frame = new Frame('test');
  const keys = frame.sortKeys(entries, parents, new Map());
  const shown = frame.displayOrder(entries, 'fixed', keys).map((e) => e.workspace);
  assert.deepEqual(shown, ['app', 'feat', 'hotfix', 'other', 'scratch']);
});

test('fixed ignores activity', () => {
  const frame = new Frame('test');
  frame.lastWorkingAt.set('scratch:p1', 10 * 60000);
  frame.lastWorkingAt.set('hotfix:p1', 5 * 60000);
  const keys = frame.sortKeys(entries, parents, new Map());
  const shown = frame.displayOrder(entries, 'fixed', keys).map((e) => e.workspace);
  assert.deepEqual(shown, ['app', 'feat', 'hotfix', 'other', 'scratch']);
});

test('family_key sorts the same as the predicted display order', () => {
  const frame = new Frame('test');
  const keys = frame.sortKeys(entries, parents, new Map());
  const byKey = [...entries]
    .sort((a, b) => {
      const ka = keys.familyKeys.get(a.workspace);
      const kb = keys.familyKeys.get(b.workspace);
      return ka === kb ? 0 : ka < kb ? -1 : 1;
    })
    .map((e) => e.workspace);
  assert.deepEqual(byKey, ['app', 'feat', 'hotfix', 'other', 'scratch']);
});

test('fixed is reachable by name, by cycle and back out by flip', () => {
  assert.equal(view.resolve(null, { set: 'fixed' }), 'fixed');
  assert.equal(view.resolve('recent', { op: 'cycle' }), 'fixed');
  assert.equal(view.resolve('fixed', { op: 'cycle' }), null);
  assert.equal(view.resolve('fixed', { op: 'flip' }), 'grouped');
});
