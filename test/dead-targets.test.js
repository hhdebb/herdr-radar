'use strict';

// A pane or workspace that has closed is cleared once, then forgotten (#21).
//
// Herdr answers a report to a target that no longer exists with a not-found
// error. It used to count as a failed write, which put the target into the
// frame's retry backoff — capped at a minute, never giving up — so every
// target that ever closed was cleared again once a minute for the life of the
// daemon, most IPC calls ended in errors, and each pending retry kept waking
// the scheduler. The IPC call is replaced here; nothing reaches a real Herdr.

const test = require('node:test');
const assert = require('node:assert/strict');

const ipc = require('../lib/ipc');
const herdr = require('../lib/herdr');
const { Frame } = require('../lib/frame');

const error = (code) => async () => ({ error: { code, message: code } });

test('a report to a pane that is gone counts as landed', async (t) => {
  t.mock.method(ipc, 'call', error('pane_not_found'));
  assert.equal(await herdr.reportMetadataAsync('w9:p2', 'test', { a: null }), true);
});

test('a report to a workspace that is gone counts as landed', async (t) => {
  t.mock.method(ipc, 'call', error('workspace_not_found'));
  assert.equal(await herdr.reportWorkspaceMetadataAsync('w9', 'test', { a: null }), true);
});

// The other direction: only "the target is gone" is final. Anything else is a
// write that did not happen and has to be tried again.
test('any other error is still a failure', async (t) => {
  t.mock.method(ipc, 'call', error('internal_error'));
  assert.equal(await herdr.reportMetadataAsync('w1:p1', 'test', { a: null }), false);
});

test('a closed pane is cleared once and then forgotten', async (t) => {
  t.mock.method(ipc, 'call', error('pane_not_found'));
  const frame = new Frame('test');
  frame.lastLine.set('w9:p2', 'painted');
  // A repaint that failed while the pane was still open: its backoff is for a
  // pane that no longer exists, and has to go with it.
  frame.failedAt.set('line:w9:p2', { count: 1, until: 2000 });

  let jobs = [];
  frame.clearGone(new Set(), 0, jobs);
  await Promise.all(jobs);
  assert.equal(frame.lastLine.has('w9:p2'), false, 'the closed pane is still tracked');
  assert.equal(frame.failedAt.size, 0, 'the closed pane was put into retry backoff');

  // A later frame, past any backoff: there must be nothing left to send.
  const sent = ipc.call.mock.callCount();
  jobs = [];
  frame.clearGone(new Set(), 10 * 60 * 1000, jobs);
  await Promise.all(jobs);
  assert.equal(ipc.call.mock.callCount(), sent, 'the closed pane was cleared again');
});

test('a closed workspace is cleared once and then forgotten', async (t) => {
  t.mock.method(ipc, 'call', error('workspace_not_found'));
  const frame = new Frame('test');
  frame.lastSpace.set('w9', 'painted');

  const jobs = [];
  frame.spaceJobs(new Map(), new Map(), 0, jobs);
  await Promise.all(jobs);
  assert.equal(frame.lastSpace.has('w9'), false, 'the closed workspace is still tracked');
  assert.equal(frame.failedAt.size, 0, 'the closed workspace was put into retry backoff');
});

test('a clear that genuinely failed is kept for a retry', async (t) => {
  t.mock.method(ipc, 'call', error('internal_error'));
  const frame = new Frame('test');
  frame.lastLine.set('w1:p1', 'painted');

  const jobs = [];
  frame.clearGone(new Set(), 0, jobs);
  await Promise.all(jobs);
  assert.equal(frame.lastLine.has('w1:p1'), true, 'a failed clear dropped the pane anyway');
  assert.equal(frame.failedAt.size, 1, 'a failed clear was not scheduled for a retry');
});
