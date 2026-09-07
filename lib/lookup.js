'use strict';

// Cached lookups of everything the renderer needs from Herdr.
//
// The status entry is a fixed-interval timer — Herdr does not re-run it when
// focus changes — so the only way to shorten the lag after switching tabs is to
// shorten the interval, and the only way to afford a short interval is to make
// each tick cheap. Three CLI round trips cost ~135ms; most ticks need none of
// them because nothing moved.
//
// Each render is a fresh process, so the cache lives in a file. It is keyed by
// pane and workspace: switching panes is a miss (which is exactly the moment
// the values must be fresh), and staying put is a hit.

const path = require('node:path');
const { stateRoot } = require('./paths');
const { readJson, writeJson } = require('./cache');
const { pane: paneGet, tabRowWidth, workspaceGet } = require('./herdr');

const CACHE_FILE = path.join(stateRoot, 'lookup-cache.json');

// Geometry only changes when the window is resized or a tab is opened; a few
// seconds of staleness there costs at most one slightly mis-sized line, and the
// hard cap in the renderer keeps that from hiding the status area.
const TTL_MS = 8000;

function fresh(entry, paneId, workspaceId, now) {
  return (
    entry &&
    entry.pane_id === paneId &&
    entry.workspace_id === workspaceId &&
    typeof entry.at === 'number' &&
    now - entry.at < TTL_MS
  );
}

// { agent, cwd, row, tabs, cached }
function paneContext(paneId, workspaceId, now = Date.now()) {
  const cached = readJson(CACHE_FILE);
  if (fresh(cached, paneId, workspaceId, now)) {
    return { ...cached, cached: true };
  }

  const pane = paneGet(paneId);
  const entry = {
    pane_id: paneId,
    workspace_id: workspaceId,
    agent: pane?.agent ?? null,
    // foreground_cwd is the foreground process's live directory; cwd only
    // knows where the pane launched (plus OSC7 updates where the shell
    // emits them — see shell/herdr-osc7.*).
    cwd: pane?.foreground_cwd ?? pane?.cwd ?? null,
    row: tabRowWidth(paneId),
    tabs: workspaceGet(workspaceId)?.tab_count ?? 1,
    at: now,
  };
  writeJson(CACHE_FILE, entry);
  return { ...entry, cached: false };
}

module.exports = { paneContext, TTL_MS };
