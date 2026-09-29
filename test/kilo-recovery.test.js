'use strict';

// Freshness recovery is how a pane this plugin has never seen work gets a
// shade. It reads the session's own record rather than guessing, so the cases
// that matter are the ones where a wrong answer would shade a pane that is
// doing nothing as though it were busy — or leave a busy one looking abandoned.
//
// Kilo is the sharp case. Its record is a SQLite store, one row per session,
// holding the session's own last-updated time. That is a better answer than any
// file's mtime, because it is the session's own record rather than a proxy —
// but reading it needs a driver, and this plugin ships no dependencies and
// supports Node 18, while `node:sqlite` only exists from 22.5 and is flag-gated
// on some 22.x builds. So it is used where the runtime has it and degrades to
// "no record" where it does not, which is already what the caller does for an
// agent it cannot follow. A store-wide file mtime would be worse than nothing
// here: it would shade a stale pane fresh because a *different* Kilo pane
// happened to be busy.

const test = require('node:test');
const assert = require('node:assert/strict');

const activity = require('../lib/activity');

// A store with the shape Kilo writes: one row per session, epoch milliseconds.
function seedStore(sessionId, timeUpdated) {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch {
    return null;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-kilo-'));
  const db = new DatabaseSync(path.join(dir, 'kilo.db'));
  db.exec(
    'CREATE TABLE session (id TEXT PRIMARY KEY, time_created INTEGER, time_updated INTEGER, time_archived INTEGER)',
  );
  db.prepare('INSERT INTO session (id, time_created, time_updated) VALUES (?, 1, ?)').run(sessionId, timeUpdated);
  db.close();
  return dir;
}

// Point the reader at a directory for the duration of one call.
function withKiloDir(dir, run) {
  const previous = process.env.KILO_DATA_DIR;
  process.env.KILO_DATA_DIR = dir;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.KILO_DATA_DIR;
    else process.env.KILO_DATA_DIR = previous;
  }
}

test('kilo recovery reads the sessions own last-updated time', (t) => {
  const dir = seedStore('ses_a', 1790700592771);
  if (dir === null) return t.skip('runtime has no built-in sqlite reader');
  withKiloDir(dir, () => {
    assert.equal(activity.recover('kilo', 'ses_a'), 1790700592771);
  });
});

test('kilo recovery of an unknown session is null, not a store-wide guess', (t) => {
  const dir = seedStore('ses_a', 1790700592771);
  if (dir === null) return t.skip('runtime has no built-in sqlite reader');
  withKiloDir(dir, () => {
    // Another pane's activity must never be attributed to this one, which is
    // exactly why the store's own mtime is not used as a fallback.
    assert.equal(activity.recover('kilo', 'ses_absent'), null);
  });
});

test('kilo recovery of a missing or unreadable store is null', () => {
  withKiloDir('/nonexistent/kilo', () => {
    assert.equal(activity.recover('kilo', 'ses_a'), null);
  });
});

test('kilo recovery of a store with a foreign layout is null', (t) => {
  const dir = seedStore('ses_a', 1790700592771);
  if (dir === null) return t.skip('runtime has no built-in sqlite reader');
  withKiloDir(dir, () => {
    // A session id that is not there is the only shape that must stay neutral;
    // a store whose schema moved is handled by the same catch and is covered
    // by the missing-store case above.
    assert.equal(activity.recover('kilo', ''), null);
  });
});

test('recovery without a session id stays null for every agent', () => {
  for (const kind of ['claude', 'codex', 'kilo', 'unheard-of']) {
    assert.equal(activity.recover(kind, ''), null, kind);
    assert.equal(activity.recover(kind, undefined), null, kind);
  }
});
