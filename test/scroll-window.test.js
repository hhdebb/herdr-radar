'use strict';

// The settings list scrolls with the cursor once it is taller than the popup.
// A popup sized as a share of the terminal can be short on a small window, and
// a list that did not scroll lost its top rows off the screen.

const test = require('node:test');
const assert = require('node:assert/strict');

const { scrollTop } = require('../lib/scroll-window');

test('a list that fits never scrolls', () => {
  assert.equal(scrollTop(6, 5, 8, 0), 0);
});

test('moving down past the window scrolls just enough to keep the cursor', () => {
  assert.equal(scrollTop(20, 12, 8, 0), 5);
});

test('moving up past the window scrolls back to the cursor', () => {
  assert.equal(scrollTop(20, 3, 8, 5), 3);
});

test('a cursor inside the window leaves it where it is', () => {
  assert.equal(scrollTop(20, 7, 8, 5), 5);
});

test('the window never runs past the end of the list', () => {
  assert.equal(scrollTop(20, 19, 8, 18), 12);
});

test('wrapping from the last row to the first shows the top again', () => {
  assert.equal(scrollTop(20, 0, 8, 12), 0);
});

test('wrapping from the first row to the last shows the bottom', () => {
  assert.equal(scrollTop(20, 19, 8, 0), 12);
});
