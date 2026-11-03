'use strict';

// Worktrees whose checkout has no agent on the panel are orphans: no parent
// pane to hang a corner off, so each gets a synthesised repo row instead. Two
// orphans of one repo are still one family, though. Ranked on their own, an
// unrelated project busy in between split them, and the panel read
// `app / feature`, `other`, `app / hotfix` — the repo twice, its branches apart.
// They rank as a family and share the first one's repo row.

const test = require('node:test');
const assert = require('node:assert/strict');

const herdr = require('../lib/herdr');
const state = require('../lib/state');
const { Frame } = require('../lib/frame');
const config = require('../lib/config');

const mark = config.worktreeMark ? `${config.worktreeMark} ` : '';

// `app` itself is not on the list: its checkout is open but runs no agent.
const entries = ['feature', 'other', 'hotfix'].map((ws) => ({
  pane: `${ws}:p1`,
  workspace: ws,
  tab: `${ws}:t1`,
  name: 'claude',
  title: 'x',
}));
const worktrees = new Map([
  ['feature', 'app'],
  ['hotfix', 'app'],
]);
// Activity, in minutes: feature busiest, then the unrelated project, then hotfix.
const activity = { feature: 3, other: 2, hotfix: 1 };

function treeFor(viewMode, parents, list = entries, repos = worktrees) {
  const frame = new Frame('test');
  for (const entry of list) frame.lastWorkingAt.set(entry.pane, activity[entry.workspace] * 60000);
  const ranks = frame.sortKeys(list, parents, repos);
  const displayEntries = frame.displayOrder(list, viewMode, ranks);
  return { tree: frame.strayWorktrees(displayEntries, ranks), displayEntries };
}

async function groupsFor(t, list, tree) {
  const sent = new Map();
  t.mock.method(herdr, 'reportMetadataAsync', async (pane, _source, tokens) => {
    sent.set(pane, tokens);
    return true;
  });
  const labels = new Map(list.map((entry) => [entry.workspace, entry.workspace]));
  await state.writeGroups('test', list, labels, new Set(), {
    parentOf: tree.parentOf,
    orphanRepo: tree.orphanRepo,
    orphanFamily: tree.orphanFamily,
    detached: tree.detached,
  });
  return sent;
}

const order = (displayEntries) => [...new Set(displayEntries.map((entry) => entry.workspace))];
const openCheckout = new Map([
  ['feature', 'app'],
  ['hotfix', 'app'],
]);

test('orphans of one repo rank as a family, ahead of a project busy in between', () => {
  const { displayEntries } = treeFor('grouped', openCheckout);
  assert.deepEqual(order(displayEntries), ['feature', 'hotfix', 'other']);
});

test('the family holds when the checkout was never opened as a workspace', () => {
  const { displayEntries } = treeFor('grouped', new Map());
  assert.deepEqual(order(displayEntries), ['feature', 'hotfix', 'other']);
});

test('two open checkouts that share a repo name stay two families', () => {
  const parents = new Map([
    ['feature', 'app-one'],
    ['hotfix', 'app-two'],
  ]);
  const { tree, displayEntries } = treeFor('grouped', parents);
  assert.deepEqual(order(displayEntries), ['feature', 'other', 'hotfix']);
  assert.notEqual(tree.orphanFamily.get('feature'), tree.orphanFamily.get('hotfix'));
});

test('the family is drawn under one repo row, tee then corner, no spacer inside', async (t) => {
  const { tree, displayEntries } = treeFor('grouped', openCheckout);
  const sent = await groupsFor(t, displayEntries, tree);
  const repoRows = [...sent.values()].filter((tokens) => tokens.group_parent === 'app');
  assert.equal(repoRows.length, 1, 'app appears once');
  assert.equal(sent.get('feature:p1').group_parent, 'app', 'on the first of the family');
  assert.equal(sent.get('feature:p1').group, `├─ ${mark}feature`, 'a tee: the family goes on below it');
  assert.equal(sent.get('hotfix:p1').group_parent, null, 'the sibling joins the row above');
  assert.equal(sent.get('hotfix:p1').group, `${state.INDENT}└─ ${mark}hotfix`, 'indented like a real child');
  assert.equal(sent.get('feature:p1').gap, null, 'no blank line between siblings');
  assert.equal(sent.get('hotfix:p1').gap, '​', 'the spacer closes the family');
});

test('a lone orphan still closes with a corner under its repo row', async (t) => {
  const list = entries.filter((entry) => entry.workspace !== 'hotfix');
  const { tree, displayEntries } = treeFor('grouped', openCheckout, list);
  const sent = await groupsFor(t, displayEntries, tree);
  assert.equal(sent.get('feature:p1').group_parent, 'app');
  assert.equal(sent.get('feature:p1').group, `└─ ${mark}feature`);
});

test("in Herdr's order an orphan away from its family keeps a repo row of its own", async (t) => {
  const { tree, displayEntries } = treeFor(null, openCheckout);
  assert.deepEqual(order(displayEntries), ['feature', 'other', 'hotfix'], "Herdr's order is left alone");
  const sent = await groupsFor(t, displayEntries, tree);
  assert.equal(sent.get('feature:p1').group, `└─ ${mark}feature`);
  assert.equal(sent.get('hotfix:p1').group_parent, 'app', 'no tee into the project above');
  assert.equal(sent.get('hotfix:p1').group, `└─ ${mark}hotfix`);
});
