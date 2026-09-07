#!/usr/bin/env node
'use strict';

require('../lib/node-version');

// The tab-bar renderer, called from `ui.tab_bar_right` every few seconds.
// It shows one thing: the focused pane's working directory.
//
// Two hard constraints, both found by testing rather than from the docs:
//
// 1. Nothing slow on this path. Each render is a fresh process on a fixed
//    timer, so the Herdr lookups are cached (lib/lookup.js) and nothing else
//    is consulted.
//
// 2. The line has to FIT. Herdr drops the whole status area when the tab row
//    is too narrow instead of truncating it, so one column too many makes the
//    status bar vanish entirely — and since path length varies per workspace,
//    that looks like "it only works in one workspace". Everything below the
//    first rendering is a fallback for a narrower row.
//
// Herdr supplies the focused pane as HERDR_ACTIVE_PANE_ID / _CWD / _TAB_ID /
// _WORKSPACE_ID (not HERDR_PANE_ID, which is pane-local). It strips the ESC
// byte out of ANSI sequences while keeping the rest, so every signal here has
// to survive as plain text. It renders the last line of output only, which
// leaves earlier lines free for debugging.

const fs = require('node:fs');
const path = require('node:path');

const { logPath, stateRoot } = require('../lib/paths');
const { paneContext } = require('../lib/lookup');
const { compose } = require('../lib/tabline');

// The width model and the path/branch fallback ladder live in lib/tabline.js
// now — the resident daemon composes the production line from there into a
// cache file. This entry point stays for live debugging (--debug prints the
// decision trail) and as the fallback renderer when no daemon exists.


const debug = process.argv.includes('--debug');
const notes = [];

function note(message) {
  if (debug) notes.push(message);
}

function activePane() {
  const paneId = process.env.HERDR_ACTIVE_PANE_ID ?? null;
  const workspaceId = process.env.HERDR_ACTIVE_WORKSPACE_ID ?? null;
  const live = paneContext(paneId, workspaceId);

  // foreground_cwd (via lookup) is the live directory of whatever runs in the
  // pane. The env fallback is Herdr's launch-time value — stale after a cd,
  // but better than nothing when the CLI call fails.
  const cwd = live.cwd ?? process.env.HERDR_ACTIVE_PANE_CWD ?? null;

  note(`pane=${paneId ?? '(none)'} agent=${live.agent ?? '(none)'} cached=${live.cached}`);
  return {
    paneId,
    agent: live.agent ?? null,
    cwd,
    row: live.row,
    tabs: live.tabs,
  };
}



function main() {
  const pane = activePane();

  const { row, tabs } = pane;
  const line = compose({ cwd: pane.cwd, row, tabs });
  note(`tabRow=${row ?? '?'} tabs=${tabs} len=${line.length}`);

  trace(pane, line, null, row);
  for (const message of notes) process.stdout.write(`# ${message}\n`);
  process.stdout.write(`${line}\n`);
}

// Opt-in call log: `touch <state dir>/trace`. The rendered entry is
// Herdr chrome, not pane output, so when it looks wrong there is nothing to
// read back — this is the only way to see what was asked and what we answered.
function trace(pane, line, budget, row) {
  if (!fs.existsSync(path.join(stateRoot, 'trace'))) return;
  try {
    fs.appendFileSync(
      logPath,
      `${JSON.stringify({
        at: new Date().toISOString(),
        env: Object.fromEntries(
          Object.entries(process.env).filter(([key]) => key.startsWith('HERDR_')),
        ),
        agent: pane.agent,
        cwd: pane.cwd,
        row,
        budget,
        length: line.length,
        out: line,
      })}\n`,
      'utf8',
    );
  } catch {
    // Tracing must never break rendering.
  }
}

try {
  main();
} catch (error) {
  // Herdr clears the entry when the command fails, which makes a bug look like
  // a missing feature. Say so instead.
  process.stdout.write(`statusbar error: ${error.message ?? error}\n`);
}
