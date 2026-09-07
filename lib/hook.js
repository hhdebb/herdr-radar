'use strict';

// The render hook: one optional user module that may rewrite what the sidebar
// shows, just before it is published. Set `render_hook` in the plugin config
// to the module's path (absolute, or relative to the config directory). The
// module exports any of
//
//   workspace(label, workspaceId)   a workspace's name (headers, Spaces list)
//   branch(label, workspaceId)      a worktree's branch label
//   title(text, paneId)             a pane's title
//   cwd(path)                       the tab-bar path
//   state(display, paneId)          the display state ('working', 'done', …)
//   activity(timestamp, paneId)     when the pane last worked (ms epoch, or
//                                   undefined) — what the activity views sort on
//   agent(name, paneId)             the vendor shown for the pane ('claude', 'codex', …)
//
// each returning the replacement. Anything not exported is left alone, and a
// function that throws is treated as "no change" — the sidebar must not go
// blank because a hook has a bug. Loaded once per daemon start; the module
// runs with the plugin's own permissions, like everything else in the config.
//
// What it is for: redacting names for a screenshot or a stream, translating or
// abbreviating titles by a house rule — anything that changes the text, not
// the mechanism. The plugin itself ships no hook.

const path = require('node:path');

const config = require('./config');

let loaded;

function load() {
  if (loaded !== undefined) return loaded;
  loaded = null;
  const spec = config.renderHook;
  if (!spec) return loaded;
  try {
    const base = process.env.HERDR_PLUGIN_CONFIG_DIR ?? process.cwd();
    const file = path.isAbsolute(spec) ? spec : path.resolve(base, spec);
    const mod = require(file);
    loaded = mod && typeof mod === 'object' ? mod : null;
  } catch {
    loaded = null;
  }
  return loaded;
}

// The hook's answer for `name`, or `value` unchanged.
function apply(name, value, ...rest) {
  const mod = load();
  const fn = mod?.[name];
  if (typeof fn !== 'function') return value;
  try {
    const out = fn(value, ...rest);
    return out === undefined ? value : out;
  } catch {
    return value;
  }
}

module.exports = { apply, load };
