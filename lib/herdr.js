'use strict';

// Talking to Herdr.
//
// Every call goes through the binary named by HERDR_BIN_PATH, which Herdr
// injects into plugin commands. `windowsHide` is on everywhere: without it a
// console process spawned from a parent that has no visible console pops a new
// console window, and this plugin spawns one per token write.

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const { herdrConfigPath, pluginId } = require('./paths');
const ipc = require('./ipc');

const TIMEOUT_MS = 5000;

function binary() {
  return process.env.HERDR_BIN_PATH ?? 'herdr';
}

// The `source` every token write is tagged with, so Herdr can tell this
// plugin's metadata from another's.
function source() {
  return `plugin:${pluginId()}`;
}

// Synchronous on purpose: callers sequence a socket call after the reload,
// and a detached spawn would make that ordering unenforceable.
function reloadConfig() {
  spawnSync(binary(), ['server', 'reload-config'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
}

// Returns the parsed JSON body, or null when the call failed for any reason.
// Callers treat a failure as "no data" rather than an error: a plugin that
// throws on a transient socket hiccup is worse than one that skips a frame.
function call(...args) {
  try {
    const result = spawnSync(binary(), args, {
      encoding: 'utf8',
      timeout: TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (result.status !== 0 || !result.stdout?.trim()) return null;
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function panes() {
  return call('pane', 'list')?.result?.panes ?? [];
}

function pane(paneId) {
  return call('pane', 'get', paneId)?.result?.pane ?? null;
}

// Null on failure, not an empty list: to a caller tracking liveness those are
// opposite claims. An empty list says every agent is gone — act on it — while
// a failed call says nothing, and acting on nothing-as-empty once wiped every
// activity stamp and cleared every token over one timed-out list during a
// config reload.
function agents() {
  return call('agent', 'list')?.result?.agents ?? null;
}

function tabs() {
  return call('tab', 'list')?.result?.tabs ?? [];
}

function workspaces() {
  return call('workspace', 'list')?.result?.workspaces ?? [];
}

// The foreground process's real working directory.
//
// Herdr's own `pane.cwd` only knows where the pane was launched — the Windows
// support matrix lists live cwd as partial — but the process table still has
// the truth for anything that actually chdir()s, which covers every agent CLI
// and bash. This is agent-agnostic, so no per-CLI hook is needed for the path.
function paneProcessCwd(paneId) {
  if (!paneId) return null;
  const foreground = call('pane', 'process-info', '--pane', paneId)
    ?.result?.process_info?.foreground_processes?.[0];
  return foreground?.cwd ?? null;
}

// Width of the tab row, in columns.
//
// The status area shares that row with the tabs and their controls, and Herdr
// drops the *entire* status area when it does not fit rather than truncating
// it — so a line that is one column too long simply disappears. `pane layout`
// reports the pane area as `{x, y, width, height}`; x is the sidebar width and
// width is what the tab row has to work with.
function tabRowWidth(paneId) {
  if (!paneId) return null;
  const area = call('pane', 'layout', '--pane', paneId)?.result?.layout?.area;
  return typeof area?.width === 'number' ? area.width : null;
}

// Async socket twins of the four list reads. Every CLI call is a process
// spawn; the daemon reads the agent list up to seven times a second while
// something animates, which made the read path the largest remaining spawn
// source once the writes moved to the socket. Transport failure falls back to
// one CLI attempt, preserving each sync function's own failure semantics
// (agents: null on failure; the rest: empty list).
async function readListAsync(method, key, fallback) {
  const reply = await ipc.call(method, {});
  if (reply && !reply.error) return reply.result?.[key] ?? null;
  return fallback();
}

function agentsAsync() {
  return readListAsync('agent.list', 'agents', agents);
}

function workspacesAsync() {
  return readListAsync('workspace.list', 'workspaces', workspaces).then((v) => v ?? []);
}

function tabsAsync() {
  return readListAsync('tab.list', 'tabs', tabs).then((v) => v ?? []);
}

function panesAsync() {
  return readListAsync('pane.list', 'panes', panes).then((v) => v ?? []);
}

// Whether the Agents panel is in its grouped ("spaces") order. The sidebar's
// grouped/priority toggle persists `agent_panel_sort` into Herdr's config.toml
// and nowhere else — no CLI query, no event — so the file is the one place the
// mode can be read from. Cached briefly: the animator asks every tick.
const sortCache = { at: 0, grouped: true };

function panelGrouped(now = Date.now()) {
  if (now - sortCache.at < 2000) return sortCache.grouped;
  let grouped = true;
  try {
    const mode = fs
      .readFileSync(herdrConfigPath(), 'utf8')
      .match(/^\s*agent_panel_sort\s*=\s*"([^"]+)"/m)?.[1];
    grouped = mode !== 'priority';
  } catch {
    // An unreadable config reads as Herdr's default, which is grouped.
  }
  Object.assign(sortCache, { at: now, grouped });
  return grouped;
}

function workspaceGet(workspaceId) {
  if (!workspaceId) return null;
  return call('workspace', 'get', workspaceId)?.result?.workspace ?? null;
}

// Set and clear display tokens in one call. `tokens` maps name -> value, where
// null or undefined means "clear this one".
//
// Clearing matters as much as setting: this plugin encodes state in *which*
// token is present (one colour per token name, since Herdr's row styles are
// static), so a stale name left behind renders beside the current one.
function reportMetadata(paneId, source, tokens) {
  const args = ['pane', 'report-metadata', paneId, '--source', source];
  for (const [name, value] of Object.entries(tokens)) {
    if (value === null || value === undefined) args.push('--clear-token', name);
    else args.push('--token', `${name}=${value}`);
  }
  return call(...args) !== null;
}

// Workspace-level twin of reportMetadata, for tokens the Spaces list renders.
function reportWorkspaceMetadata(workspaceId, source, tokens) {
  const args = ['workspace', 'report-metadata', workspaceId, '--source', source];
  for (const [name, value] of Object.entries(tokens)) {
    if (value === null || value === undefined) args.push('--clear-token', name);
    else args.push('--token', `${name}=${value}`);
  }
  return call(...args) !== null;
}

// The socket API's token patch: name -> value, null meaning clear — the same
// contract the CLI flags encode, minus the process spawn.
function tokenPatch(tokens) {
  const patch = {};
  for (const [name, value] of Object.entries(tokens)) patch[name] = value ?? null;
  return patch;
}

// Async twins of the two report calls, over the socket. The CLI wrapper costs
// a process spawn per write — 40-80ms on Windows — which turns any repaint
// touching every pane into seconds of visible catching-up. Socket calls run
// in parallel; a transport failure falls back to one CLI attempt so a machine
// where the socket misbehaves degrades to slow, not broken.
async function reportMetadataAsync(paneId, source, tokens) {
  const reply = await ipc.call('pane.report_metadata', {
    pane_id: paneId,
    source,
    tokens: tokenPatch(tokens),
  });
  if (reply) return !reply.error;
  return reportMetadata(paneId, source, tokens);
}

async function reportWorkspaceMetadataAsync(workspaceId, source, tokens) {
  const reply = await ipc.call('workspace.report_metadata', {
    workspace_id: workspaceId,
    source,
    tokens: tokenPatch(tokens),
  });
  if (reply) return !reply.error;
  return reportWorkspaceMetadata(workspaceId, source, tokens);
}

module.exports = {
  pluginId,
  source,
  reloadConfig,
  call,
  panes,
  pane,
  paneProcessCwd,
  tabRowWidth,
  agents,
  tabs,
  workspaces,
  workspaceGet,
  agentsAsync,
  workspacesAsync,
  tabsAsync,
  panesAsync,
  panelGrouped,
  reportMetadata,
  reportWorkspaceMetadata,
  reportMetadataAsync,
  reportWorkspaceMetadataAsync,
  binary,
};
