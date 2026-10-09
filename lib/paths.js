'use strict';

// Where this plugin's files live: Herdr's config file, Herdr's state
// directory, and the plugin's own state directory inside it.

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const identity = require('./identity');

// Herdr injects the plugin id into every command it runs; the fallback covers
// a bare shell run of the same scripts.
function pluginId() {
  return process.env.HERDR_PLUGIN_ID ?? identity.PLUGIN_ID;
}

// One state directory for everything this plugin caches or logs — the one
// Herdr allots it (HERDR_PLUGIN_STATE_DIR). Commands Herdr starts get that
// injected; the tab-bar `type` command and a bare shell run do not, so the
// same location is derived the way Herdr lays it out:
// <herdr state dir>/plugins/<plugin id>. <ENV_PREFIX>_STATE overrides both.
const stateRoot =
  identity.env('STATE') ?? process.env.HERDR_PLUGIN_STATE_DIR ?? path.join(herdrStateDir(), 'plugins', pluginId());

// Which Herdr session this process talks to, as a path-safe suffix.
//
// Herdr gives every session the same HERDR_PLUGIN_STATE_DIR, but a named
// session runs its own server on its own socket. The daemon keys its lock and
// its control endpoint off the state directory, so with one directory the
// second session's `state-start` finds the first session's daemon healthy and
// exits — and that daemon reports through the FIRST session's socket. The
// second session then shows a sidebar with no labels at all, because the rows
// are built from tokens only the daemon writes (#25).
//
// Named sockets live at <config>/herdr/sessions/<name>/herdr.sock, the default
// session's sits one level up. An empty suffix for the default session keeps
// every existing path exactly where it is, so nothing has to migrate.
function sessionSuffix() {
  const socket = process.env.HERDR_SOCKET_PATH;
  if (!socket) return '';
  // Normalise first: `<config>/herdr/sessions/../herdr.sock` names the default
  // session's socket, and reading its segments raw would call the session `..`
  // and build a directory out of it.
  const dir = path.dirname(path.normalize(socket));
  if (path.basename(path.dirname(dir)) !== 'sessions') return '';
  const name = path.basename(dir);
  if (name === '.' || name === '..') return '';
  // Keep it to characters every filesystem and the Windows pipe namespace
  // accept; a session name is user-chosen.
  const safe = name.replace(/[^A-Za-z0-9._-]/g, '_');
  return safe ? `-${safe}` : '';
}

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // Callers degrade to "no data" rather than failing a render.
  }
  return dir;
}

// Herdr's own config file. Some of what this plugin adapts to lives only
// there — the sidebar's grouped/priority toggle persists into it, and there is
// no CLI query and no event for the switch.
// `XDG_CONFIG_HOME` wins everywhere, Windows included — Herdr honours it there
// too (its socket lands next to the config it actually read, which is how this
// was caught). Assuming `%APPDATA%` on win32 meant writing theme and sidebar
// blocks into a file Herdr never reads: the managed blocks looked correct on
// disk, the sidebar kept rendering yesterday's colours, and a desktop that had
// gone dark hours earlier never took. Falling back to `%APPDATA%` only when the
// variable is unset keeps the old machines working.
function herdrConfigPath() {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return path.join(xdg, 'herdr', 'config.toml');
  const base =
    process.platform === 'win32'
      ? (process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'))
      : path.join(os.homedir(), '.config');
  return path.join(base, 'herdr', 'config.toml');
}

// Herdr's own state directory — where it caches downloaded detection
// manifests. NOT the config directory (its config.rs keeps state_dir and
// config_dir apart), and a different XDG variable governs it.
function herdrStateDir() {
  if (process.env.XDG_STATE_HOME) return path.join(process.env.XDG_STATE_HOME, 'herdr');
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'herdr');
  }
  return path.join(os.homedir(), '.local', 'state', 'herdr');
}

// A plugin's config directory, for scripts Herdr did not start (a bare shell
// run, a key binding): Herdr only injects HERDR_PLUGIN_CONFIG_DIR into plugin
// commands, and the layout is <config root>/plugins/config/<plugin id>.
function pluginConfigDir(pluginId) {
  return path.join(path.dirname(herdrConfigPath()), 'plugins', 'config', pluginId);
}

// Where the daemon's own runtime lives: its lock, its stop marker and its
// control endpoint. Scoped per session so each gets its own daemon.
//
// The default session keeps stateRoot itself. Giving it `runtime/` too would
// move its lock, its stop marker and its control endpoint, and an upgrade
// would then leave the running 1.3.x daemon orphaned: the new watchdog finds
// no lock and starts a second daemon on the same socket, and `--stop` writes
// a marker the old daemon never watches, so it survives while the tokens it
// published are cleared and the sidebar goes blank.
//
// For a named session this is deliberately NOT the whole state directory.
// The caches stay in stateRoot: they are session-agnostic, and the tab-bar
// line has its own per-session name (tabbarCache below).
const runtimeSuffix = sessionSuffix();
const runtimeRoot = runtimeSuffix ? path.join(stateRoot, 'runtime' + runtimeSuffix) : stateRoot;

// The tab-bar line, one file per session. With a daemon per session, one
// shared file had two writers, and a session's tab bar showed the other
// session's directory until its own line next changed.
//
// The name comes from HERDR_SESSION, not the socket, because the reader is the
// status command in config.toml — one file for every session — and the shell
// it runs in can test a variable but cannot parse a path. Herdr sets the
// variable in a named session's server, and every process it starts inherits
// it: our hooks, so the daemon, and the status command. The default session's
// server never has it (Herdr drops `default` too), so its file keeps the name
// it has always had. A session name is [A-Za-z0-9._-] (Herdr validates it),
// safe in a file name and inside cmd's and sh's quotes alike.
function tabbarCache(session = process.env.HERDR_SESSION) {
  const named = session && session !== 'default' && /^[A-Za-z0-9._-]+$/.test(session);
  return path.join(stateRoot, named ? `tabbar-${session}.txt` : 'tabbar.txt');
}

module.exports = {
  pluginId,
  pluginConfigDir,
  stateRoot,
  runtimeRoot,
  sessionSuffix,
  tabbarCache,
  ensureDir,
  herdrConfigPath,
  herdrStateDir,
  logPath: path.join(stateRoot, 'tab-bar.log'),
};
