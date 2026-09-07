'use strict';

// The tab-bar status line, composed for two callers: the resident daemon,
// which precomputes it into a cache file that Herdr's status command merely
// `type`s / `cat`s out, and bin/tab-bar.js, the standalone debug entry that
// still renders live from Herdr's injected environment.
//
// The daemon has no HERDR_ACTIVE_* environment — those are stamped per
// status-command run — so it finds the focused pane in the pane list's own
// `focused` flag and asks for the rest over the socket. Events never carry
// facts here either: focus is read fresh every refresh.

const fs = require('node:fs');
const path = require('node:path');

const ipc = require('./ipc');
const herdr = require('./herdr');
const { stateRoot, ensureDir } = require('./paths');
const identity = require('./identity');
const hook = require('./hook');
const { shortenPath, basename } = require('./format');
const { branch } = require('./git');

// Columns the tab row spends before the status area gets a turn. Calibrated
// against what actually rendered on an 85-column row (see bin/tab-bar.js for
// the calibration story). Deliberately biased high: a line one column too
// long makes the whole status area vanish, a short one drops detail.
const RESERVE_FIXED = Number(identity.env('TABBAR_RESERVE') ?? 24);
const RESERVE_PER_TAB = Number(identity.env('TABBAR_RESERVE_PER_TAB') ?? 5);
const FALLBACK_WIDTH = 80;
const MAX_LINE = Number(identity.env('TABBAR_MAX') ?? 48);

const CACHE = () => path.join(ensureDir(stateRoot), 'tabbar.txt');

// The row carries two values, and they lose width very differently. A path is
// mostly redundant — its information sits at the right end, in the project
// name — so leading segments go first. A branch is short already and changes
// under you, which is the whole reason for showing it, so every fallback
// keeps it until the path has nothing left to give.
function candidates(cwd) {
  const paths = [
    shortenPath(cwd, 200),
    shortenPath(cwd, 40),
    shortenPath(cwd, 24),
    basename(cwd),
  ].filter((line) => typeof line === 'string' && line.length > 0);

  const head = branch(cwd);
  if (!head) return paths;
  return [...paths.map((line) => `${line} · ${head}`), ...paths, head];
}

function compose({ cwd, row, tabs }) {
  const reserve = RESERVE_FIXED + RESERVE_PER_TAB * (tabs ?? 1);
  const budget = Math.max(12, Math.min((row ?? FALLBACK_WIDTH) - reserve, MAX_LINE));
  const options = candidates(cwd);
  return options.find((option) => option.length <= budget) ?? options[options.length - 1] ?? '';
}

/* ------------------------------------------------------------ daemon side */

async function foregroundCwd(paneId) {
  const reply = await ipc.call('pane.process_info', { pane_id: paneId });
  return reply?.result?.process_info?.foreground_processes?.[0]?.cwd ?? null;
}

async function rowWidth(paneId) {
  const reply = await ipc.call('pane.layout', { pane_id: paneId });
  const width = reply?.result?.layout?.area?.width;
  return typeof width === 'number' ? width : null;
}

// The line as of right now, from live state only. Empty when nothing is
// focused or the reads fail — an empty cache file makes Herdr hide the
// segment, which beats showing a stale one confidently.
async function snapshotLine() {
  const panes = await herdr.panesAsync();
  const focused = panes.find((pane) => pane.focused);
  if (!focused || typeof focused.pane_id !== 'string') return '';

  const [cwd, row, tabs] = await Promise.all([
    foregroundCwd(focused.pane_id),
    rowWidth(focused.pane_id),
    herdr.tabsAsync(),
  ]);
  const tabCount = tabs.filter((tab) => tab.workspace_id === focused.workspace_id).length || 1;
  return compose({
    cwd: hook.apply('cwd', cwd ?? focused.cwd ?? null),
    row,
    tabs: tabCount,
  });
}

let published = null;

// Atomic replace, and only when the content changed: `type` can run at any
// moment, and a half-written file's torn line would be shown as the status —
// the command keeps only the last line of whatever it reads.
function publish(line) {
  const text = `${line}\n`;
  if (published === text) return;
  const target = CACHE();
  const tmp = `${target}.tmp`;
  try {
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, target);
    published = text;
  } catch {
    // The next refresh tries again.
  }
}

module.exports = { compose, candidates, snapshotLine, publish, CACHE };
