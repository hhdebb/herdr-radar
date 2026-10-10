'use strict';

// A live handoff replaces Herdr's server under a daemon that keeps running.
//
// The new server starts with no metadata tokens and no agent-view override:
// neither is in the handoff manifest. The daemon's subscription reconnects on
// its own, but every write cache in the Frame still says "already sent", so
// nothing that had not changed since was ever written again — group headers,
// indents, logos and sort keys stayed missing until the daemon was restarted.
// A reconnect is the only signal the server gives, so a reconnect has to make
// the frame repaint from nothing.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const activity = require('../lib/activity');
const herdr = require('../lib/herdr');
const subscribe = require('../lib/subscribe');
const { Frame } = require('../lib/frame');

const keys = {
  minuteKey: () => '000000000001',
  wsKeys: new Map([['w0', 'ws-key']]),
  tabKeys: new Map(),
};

const entry = {
  pane: 'w0:p1',
  terminal: 'term_a',
  workspace: 'w0',
  tab: 'w0:t1',
  name: 'codex',
  title: 'Migrate invoices table',
  status: 'idle',
};

async function paint(frame) {
  const jobs = [];
  frame.paneJobs(entry, 'idle', { tabs: new Map(), keys, indent: '', spinStep: 0 }, 5000, [], jobs);
  await Promise.all(jobs);
}

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

test('a frame that forgot its writes repaints an unchanged pane in full', async (t) => {
  const sent = record(t);
  const frame = new Frame('test');
  frame.members = 'a layout already written';

  await paint(frame);
  const first = Object.assign({}, ...sent.map(([, tokens]) => tokens));
  sent.length = 0;

  await paint(frame);
  assert.deepEqual(sent, [], 'an unchanged pane was written twice');

  frame.forgetWrites();
  await paint(frame);
  const again = Object.assign({}, ...sent.map(([, tokens]) => tokens));
  assert.deepEqual(again, first, 'the repaint after a new server left tokens unwritten');
  assert.equal(frame.members, '', 'the group layout still reads as written');
});

// The reconnect is noticed while a frame may still be writing. That write
// lands on the new server as a DELTA and then records the full set as sent, so
// a cache cleared before it lands is refilled by it — and a token that does
// not change afterwards is never sent. The clear waits for the next frame instead.
test('a write in flight when the server changed does not stand in for the repaint', async (t) => {
  const sent = record(t);
  const frame = new Frame('test');
  const moved = { ...entry, title: 'Backfill the ledger' };
  const paintMoved = async () => {
    const jobs = [];
    frame.paneJobs(moved, 'idle', { tabs: new Map(), keys, indent: '', spinStep: 0 }, 5000, [], jobs);
    return jobs;
  };

  await paint(frame);
  // The state mark: part of every full write, and the same from one idle frame
  // to the next, so nothing but a full repaint ever sends it again.
  const mark = Object.assign({}, ...sent.map(([, tokens]) => tokens)).state_idle;
  assert.ok(mark, 'the row has no state mark to lose');

  // One token moved, and its write is still out when the reconnect arrives.
  const inFlight = await paintMoved();
  frame.resync();
  await Promise.all(inFlight);

  sent.length = 0;
  frame.beginFrame();
  await Promise.all(await paintMoved());
  const repaint = Object.assign({}, ...sent.map(([, tokens]) => tokens));
  assert.equal(repaint.state_idle, mark, 'the new server was left without the state mark');
});

// The Spaces row is made of nothing but these tokens, name included: a
// workspace that lost them renders as a blank line under its machine.
test('a frame that forgot its writes republishes a workspace label', async (t) => {
  record(t);
  const sent = [];
  t.mock.method(herdr, 'reportWorkspaceMetadataAsync', async (workspace, _source, tokens) => {
    sent.push([workspace, tokens]);
    return true;
  });
  const frame = new Frame('test');
  const paintSpaces = async () => {
    const jobs = [];
    frame.spaceJobs(new Map(), new Map([['w1', 'General']]), 5000, jobs);
    await Promise.all(jobs);
  };

  await paintSpaces();
  sent.length = 0;
  await paintSpaces();
  assert.deepEqual(sent, [], 'an unchanged workspace was written twice');

  frame.forgetWrites();
  await paintSpaces();
  const again = Object.assign({}, ...sent.filter(([ws]) => ws === 'w1').map(([, tokens]) => tokens));
  assert.equal(again.space_label, 'General', 'a new server never got the workspace label');
});

// Unix only: the stream is found through HERDR_SOCKET_PATH, which on Windows
// names a marker file beside a pipe rather than the endpoint itself.
test('a reconnected subscription says so', { skip: process.platform === 'win32', timeout: 10000 }, async (t) => {
  const at = path.join(os.tmpdir(), `herdr-radar-sub-${process.pid}-${Math.random().toString(36).slice(2, 8)}.sock`);
  const previous = process.env.HERDR_SOCKET_PATH;
  process.env.HERDR_SOCKET_PATH = at;

  const sockets = new Set();
  let connections = 0;
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    connections += 1;
    const first = connections === 1;
    socket.once('data', () => {
      socket.write('{"id":"daemon-sub","result":{"type":"subscribed"}}\n');
      // The old server exits; the listener is already the new one's.
      if (first) setTimeout(() => socket.destroy(), 20);
    });
  });
  await new Promise((resolve) => server.listen(at, resolve));

  let wakes = 0;
  let subscription;
  const reconnected = new Promise((resolve) => {
    subscription = subscribe.start({
      onWake: () => (wakes += 1),
      onReconnect: () => resolve(wakes),
      onGone: () => resolve(null),
    });
  });
  t.after(async () => {
    subscription.stop();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(at, { force: true });
    if (previous === undefined) delete process.env.HERDR_SOCKET_PATH;
    else process.env.HERDR_SOCKET_PATH = previous;
  });

  const wakesBefore = await reconnected;
  assert.notEqual(wakesBefore, null, 'the daemon gave up on a server that was still there');
  assert.equal(connections, 2);
  assert.equal(wakesBefore, 1, 'the first connection was reported as a reconnect');
});

// A server that refuses the subscription answers with an error line and hangs
// up. Every retry after that is the same refusal, not a new server.
test(
  'a refused subscription is not a reconnection',
  { skip: process.platform === 'win32', timeout: 10000 },
  async (t) => {
    const at = path.join(os.tmpdir(), `herdr-radar-sub-${process.pid}-${Math.random().toString(36).slice(2, 8)}.sock`);
    const previous = process.env.HERDR_SOCKET_PATH;
    process.env.HERDR_SOCKET_PATH = at;

    let connections = 0;
    let third;
    const thirdAttempt = new Promise((resolve) => (third = resolve));
    const server = net.createServer((socket) => {
      connections += 1;
      if (connections === 3) third();
      socket.once('data', () => socket.end('{"id":"daemon-sub","error":{"code":"invalid_params"}}\n'));
      socket.on('error', () => {});
    });
    await new Promise((resolve) => server.listen(at, resolve));

    let reconnects = 0;
    const subscription = subscribe.start({ onWake: () => {}, onReconnect: () => (reconnects += 1), onGone: () => {} });
    t.after(async () => {
      subscription.stop();
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(at, { force: true });
      if (previous === undefined) delete process.env.HERDR_SOCKET_PATH;
      else process.env.HERDR_SOCKET_PATH = previous;
    });

    await thirdAttempt;
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(reconnects, 0, 'every refused retry repainted the whole sidebar');
  },
);

// Herdr refuses a request as a whole when one entry is malformed, and it only
// offers agent status per pane: listing it bare kept the stream from ever
// opening.
test('every subscribed kind is one Herdr takes without parameters', () => {
  assert.equal(subscribe.KINDS.includes('pane.agent_status_changed'), false);
});
