'use strict';

// The age label a row can show (lib/activity.js ageLabel).
//
// `freshness` bins the same stamp into fresh/idle/stale, which is what the
// glyph needs. Once several rows share a tier that is the question left: three
// stale panes look identical until you know one is an hour old and two are
// from Tuesday.
//
// Coarse on purpose. The label is part of the frame loop's cache key, so every
// value it can take is a write; minute grain under an hour keeps that to one
// write a minute per pane.

const test = require('node:test');
const assert = require('node:assert/strict');

const { ageLabel } = require('../lib/activity');

const NOW = 1_800_000_000_000;
const sec = (n) => ageLabel(NOW - n * 1000, NOW);

const CASES = [
  [0, 'now', 'this instant'],
  [89, 'now', 'just under the minute-and-a-half threshold'],
  [90, '1m', 'the first value that earns a number'],
  [3599, '59m', 'the last second before the hour'],
  [3600, '1h', 'the hour itself'],
  [7200, '2h', 'two hours'],
  [172799, '47h', 'still hours one second under two days'],
  [172800, '2d', 'two days'],
  [864000, '10d', 'ten days'],
];

for (const [seconds, expected, what] of CASES) {
  test(`ageLabel: ${what}`, () => {
    assert.equal(sec(seconds), expected);
  });
}

test('a pane this plugin has never seen work has no label', () => {
  // Same rule freshness follows: no stamp is evidence of a restart, not of
  // neglect, so the row shows nothing rather than a guess.
  assert.equal(ageLabel(undefined, NOW), null);
  assert.equal(ageLabel(null, NOW), null);
});

test('a stamp from the future reads as now, not as a negative age', () => {
  // Clocks move. A row saying "-3m" would be worse than one saying "now".
  assert.equal(ageLabel(NOW + 60_000, NOW), 'now');
});
