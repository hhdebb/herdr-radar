#!/usr/bin/env node
'use strict';

// Debug view: per pane, where Herdr thinks it launched vs where its foreground
// process actually is. When the tab bar shows a wrong path, this says whether
// Herdr's tracking drifted or the renderer picked the wrong value.

const { panes } = require('../lib/herdr');

function main() {
  const rows = panes();
  if (!rows.length) {
    console.log('no panes (is the Herdr server running?)');
    return;
  }
  console.log('pane      agent    launch cwd                                 live (foreground)');
  console.log('-'.repeat(100));
  for (const pane of rows) {
    const launch = pane.cwd ?? '(unknown)';
    const live = pane.foreground_cwd ?? '(unknown)';
    const drift = launch !== live ? '!' : ' ';
    console.log(
      `${String(pane.pane_id).padEnd(9)} ${String(pane.agent ?? '-').padEnd(8)} ${drift} ${launch.padEnd(42)} ${live}`,
    );
  }
}

main();
