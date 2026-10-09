'use strict';

// 1.3.21 took the Spaces mark row to eighteen tokens; Herdr refuses a sidebar
// row over sixteen and, with it, the whole config.toml. Three things keep that
// from coming back: the generated rows fit, a block already broken by an older
// version is recognised (the daemon rewrites it on start), and the working
// marks a vendor lost are cleared from workspaces before anything new is
// written — a stale one still counts against Herdr's 32 keys per workspace.

const test = require('node:test');
const assert = require('node:assert/strict');

const ipc = require('../lib/ipc');
const managed = require('../lib/managed-config');
const palette = require('../lib/palette');
const state = require('../lib/state');
const identity = require('../lib/identity');

test('every generated sidebar row fits Herdr’s sixteen tokens', () => {
  for (const variant of ['light', 'dark']) {
    const block = managed.sidebarBlock(variant);
    assert.equal(managed.blockOverLimit(`${block}\n`), false, variant);
  }
});

test('a block whose Spaces row is over the limit is recognised', () => {
  const sidebar = identity.markers('sidebar');
  const cells = Array.from({ length: 18 }, (_, i) => `{ token = "$t${i}" }`).join(', ');
  const broken = `${sidebar.start}\n[ui.sidebar.spaces]\nrows = [\n  [${cells}],\n  ["$x"]\n]\n${sidebar.end}\n`;
  assert.equal(managed.blockOverLimit(broken), true);
  assert.equal(managed.blockOverLimit(broken.replace(cells, '{ token = "$a" }')), false);
  assert.equal(managed.blockOverLimit('[ui]\n'), false, 'no block, nothing to repair');
  // A bracket inside a value is not a row: a rule matching "[" must not read
  // as an over-full row, or the daemon would rewrite a valid block on start.
  const rule = '{ token = "$logo", rules = [{ contains = "[", fg = "#ff0000" }] }';
  const quoted = `${sidebar.start}\n[ui.sidebar.agents]\nrows = [[${rule}]]\n${sidebar.end}\n`;
  assert.equal(managed.blockOverLimit(quoted), false, 'a bracket in a string counted as structure');
});

test('the vendors without a working cell are exactly the retired tokens', () => {
  const kept = new Set(palette.spaceWorkingVendors);
  const retired = palette.brandVendors.filter((v) => !kept.has(v)).map((v) => `space_working_${v}`);
  assert.deepEqual(state.RETIRED_SPACE_TOKENS, retired);
  for (const name of state.RETIRED_SPACE_TOKENS) assert.ok(!state.SPACE_TOKENS.includes(name), name);
});

test('retired working marks are cleared once, before the state is written', async (t) => {
  if (state.RETIRED_SPACE_TOKENS.length === 0) return t.skip('no vendor has lost its working mark');
  const sent = [];
  t.mock.method(ipc, 'call', async (method, params) => {
    sent.push(Object.keys(params.tokens ?? {}));
    return { result: {} };
  });
  await state.writeSpaceState('test', 'w-limit', 'space_none', '·', {}, 'name');
  const firstBatch = sent.length;
  assert.ok(firstBatch >= 2, 'nothing was cleared before the write');
  assert.deepEqual(sent[0].sort(), [...state.RETIRED_SPACE_TOKENS].sort(), 'the first report was not the clear');
  await state.writeSpaceState('test', 'w-limit', 'space_none', '·', {}, 'name');
  const again = sent.slice(firstBatch);
  assert.ok(
    again.every((names) => !names.some((n) => state.RETIRED_SPACE_TOKENS.includes(n))),
    'the retired marks were cleared a second time',
  );
});

// `show_age` adds a token to the agent row, and the row already sits at 14 of
// 16. Off it must not move at all; on it must still fit, or turning a setting
// on would take the whole config.toml down the way 1.3.21 did.
test('the agent row fits whether or not show_age is on', () => {
  const config = require('../lib/config');
  const before = config.showAge;
  try {
    for (const showAge of [false, true]) {
      config.showAge = showAge;
      for (const variant of ['light', 'dark']) {
        const block = managed.sidebarBlock(variant);
        assert.equal(managed.blockOverLimit(`${block}\n`), false, `${variant}, show_age=${showAge}`);
      }
    }
  } finally {
    config.showAge = before;
  }
});
