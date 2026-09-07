'use strict';

// Atomic JSON snapshots.
//
// Writers are hooks that fire while an agent is mid-turn, and the reader runs
// every few seconds from the tab bar. A half-written file must never reach the
// renderer, so writes land on a temp file and get renamed into place.

const fs = require('node:fs');
const path = require('node:path');
const { ensureDir } = require('./paths');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // Nothing left to do; the previous snapshot stays in place.
    }
    return false;
  }
}

// Age in seconds, or null when the snapshot has no usable timestamp.
function ageSeconds(snapshot, now = Date.now()) {
  const stamp = Date.parse(snapshot?.updated_at ?? '');
  if (Number.isNaN(stamp)) return null;
  return Math.max(0, Math.round((now - stamp) / 1000));
}

module.exports = { readJson, writeJson, ageSeconds };
