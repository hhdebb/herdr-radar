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
  identity.env('STATE') ??
  process.env.HERDR_PLUGIN_STATE_DIR ??
  path.join(herdrStateDir(), 'plugins', pluginId());

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
      ? process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming')
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

module.exports = {
  pluginId,
  pluginConfigDir,
  stateRoot,
  ensureDir,
  herdrConfigPath,
  herdrStateDir,
  logPath: path.join(stateRoot, 'tab-bar.log'),
};
