#!/usr/bin/env node
'use strict';

require('../lib/node-version');

// Publish `$harness_logo` — the vendor mark for whichever agent owns a pane.
//
// Run with no arguments it covers every live pane (startup). Driven by a Herdr
// event it covers just the pane the event names.
//
//   node agent-icons.js                       every pane
//   node agent-icons.js --pane wA:p1 --agent claude
//   node agent-icons.js --variant text        override the configured variant

const herdr = require('../lib/herdr');

const config = require('../lib/config');
const { logoFor } = require('../lib/logos');

const TOKEN = 'harness_logo';

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function source() {
  return arg('source') ?? herdr.source();
}

// Herdr's event payload nests the pane id at a depth that varies by event, so
// search rather than assume a shape.
function findPaneId(value) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findPaneId(entry);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    if (typeof value.pane_id === 'string') return value.pane_id;
    for (const entry of Object.values(value)) {
      const found = findPaneId(entry);
      if (found) return found;
    }
  }
  return null;
}

function targets() {
  const pane = arg('pane');
  const agent = arg('agent');
  if (pane && agent) return [{ pane, agent }];

  const raw = process.env.HERDR_PLUGIN_EVENT_JSON;
  if (raw) {
    let paneId = null;
    try {
      paneId = findPaneId(JSON.parse(raw));
    } catch {
      paneId = null;
    }
    if (!paneId) return [];
    const live = herdr.pane(paneId);
    return [{ pane: paneId, agent: live?.agent ?? null }];
  }

  return herdr.panes().map((p) => ({ pane: p.pane_id, agent: p.agent ?? null }));
}

function main() {
  const variant = arg('variant') ?? config.variant;
  const src = source();
  for (const { pane, agent } of targets()) {
    if (typeof pane !== 'string') continue;
    // Agents with no mark get the token cleared rather than a stand-in that
    // would read as the wrong vendor.
    herdr.reportMetadata(pane, src, { [TOKEN]: logoFor(agent, variant) });
  }
}

main();
