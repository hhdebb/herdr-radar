'use strict';

// When each pane last did any work, persisted across animator restarts.
//
// Herdr reports what an agent is doing, never when it last did it — so `idle`
// covers both the session you glanced at a minute ago and the one abandoned
// two days back. They look identical in the sidebar, which is useless once you
// have twenty of them. The animator already watches every status transition,
// so it is the natural place to stamp a time; the only thing missing was
// somewhere to keep it, since the animator exits whenever nothing is animating.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { stateRoot, ensureDir } = require('./paths');

const FILE = () => path.join(stateRoot, 'activity.json');

// Writing on every frame would mean a file write every 150ms for as long as an
// agent works. The value only has to survive the process, not every tick.
const WRITE_INTERVAL_MS = 5000;

let lastWrite = 0;

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    return new Map(Object.entries(raw).filter(([, at]) => typeof at === 'number'));
  } catch {
    return new Map();
  }
}

function save(map, now = Date.now(), { force = false } = {}) {
  if (!force && now - lastWrite < WRITE_INTERVAL_MS) return;
  lastWrite = now;
  try {
    ensureDir(stateRoot);
    fs.writeFileSync(FILE(), JSON.stringify(Object.fromEntries(map)), 'utf8');
  } catch {
    // Losing the stamps costs freshness shading, nothing more.
  }
}

function entries(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function mtime(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

// The last moment a session file records: the newest line carrying a
// `timestamp`. The file's own mtime lies here — reattaching a session appends
// timestamp-less marker lines (claude's `last-prompt`), so after a Herdr
// restart every transcript looks minutes old while the last real message is
// days older. Reads only the file's tail; a line the window cuts in half
// simply fails to parse and is skipped.
const TAIL_BYTES = 256 * 1024;

function lastActiveAt(file) {
  let tail;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const length = Math.min(size, TAIL_BYTES);
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, size - length);
      tail = buffer.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
  const lines = tail.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const at = Date.parse(JSON.parse(lines[i]).timestamp);
      if (Number.isFinite(at)) return at;
    } catch {
      // Not a full record; keep walking back.
    }
  }
  return mtime(file);
}

// Where each agent CLI keeps its own record of a session, by Herdr's session
// id. The record is written by the CLI itself, so it predates this plugin and
// survives its restarts.
const SESSION_RECORDS = {
  // ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
  claude(sessionId) {
    const root = path.join(os.homedir(), '.claude', 'projects');
    for (const dir of entries(root)) {
      const file = path.join(root, dir, `${sessionId}.jsonl`);
      if (fs.existsSync(file)) return lastActiveAt(file);
    }
    return null;
  },
  // ~/.codex/sessions/YYYY/MM/DD/rollout-<stamp>-<session-id>.jsonl
  codex(sessionId) {
    const root = path.join(os.homedir(), '.codex', 'sessions');
    for (const year of entries(root)) {
      for (const month of entries(path.join(root, year))) {
        const dayRoot = path.join(root, year, month);
        for (const day of entries(dayRoot)) {
          for (const name of entries(path.join(dayRoot, day))) {
            if (name.includes(sessionId)) return lastActiveAt(path.join(dayRoot, day, name));
          }
        }
      }
    }
    return null;
  },
};

// A stamp for a pane this plugin has never seen work, recovered from the
// session's own file. Sessions older than the plugin would otherwise all read
// as plain idle forever — no stamp, no shade — when most of them are exactly
// the abandoned ones the stale tier exists for. Returns null when the CLI
// keeps no record we know of, or the record cannot be found: no evidence stays
// neutral rather than guessing.
function recover(kind, sessionId) {
  if (!sessionId) return null;
  return SESSION_RECORDS[kind]?.(sessionId) ?? null;
}

// How stale an idle pane is, as a suffix on the idle state name. Panes with no
// stamp at all read as ordinary idle rather than stale: an agent this plugin
// has never seen work is not evidence of neglect, it is evidence of a restart.
function freshness(lastAt, config, now = Date.now()) {
  if (typeof lastAt !== 'number') return 'idle';
  const age = now - lastAt;
  if (age <= config.activityFreshMs) return 'idle_fresh';
  if (age >= config.activityStaleMs) return 'idle_stale';
  return 'idle';
}

module.exports = { load, save, freshness, recover };
