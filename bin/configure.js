#!/usr/bin/env node
'use strict';

require('../lib/node-version');

// Install, inspect, or remove this plugin's managed blocks in Herdr's
// config.toml (lib/managed-config.js). Safe to re-run: "repair" is the same
// code path as "install".
//
//   node bin/configure.js --check       show what is installed
//   node bin/configure.js --apply       install or repair the managed blocks
//   node bin/configure.js --uninstall   remove them
//   node bin/configure.js --rows-on     install just the sidebar block
//   node bin/configure.js --rows-off    remove just the sidebar block
//   node bin/configure.js --keys        print a key-binding snippet to paste
//
// Only the managed blocks are touched. Deliberately NOT managed:
// tab_bar_position — where the tab row lives is the user's call, not this
// plugin's — and key bindings, see --keys.

const managed = require('../lib/managed-config');
const { stopAnimator } = require('../lib/stop');
const { pluginId, reloadConfig } = require('../lib/herdr');
const { stateRoot } = require('../lib/paths');
const { NAME } = require('../lib/identity');

// Key bindings are the user's own config, not a managed block, so this only
// prints a snippet to paste. Prefix-mode keys only: a direct binding is not
// swallowed by Herdr — the pane's program receives it too — and which direct
// keys are free depends on what runs in the panes, which nobody can promise
// for another machine. `prefix+a` and `prefix+comma` are unused by Herdr's
// own bindings (as of 0.8). Both actions are `plugin_action` bindings: no
// paths, no dependence on which `node` a login shell can see.
function keybindings() {
  const id = pluginId();
  return [
    `# ${NAME} — paste into Herdr's config.toml and adjust the keys to taste.`,
    '# Both go through the prefix (ctrl+b by default) so they cannot collide',
    '# with anything running inside a pane.',
    '',
    '[[keys.command]]',
    'key = "prefix+a"',
    'type = "plugin_action"',
    `command = "${id}.view-flip"`,
    'description = "Agents: active <-> recent"',
    '',
    '[[keys.command]]',
    'key = "prefix+comma"',
    'type = "plugin_action"',
    `command = "${id}.settings"`,
    `description = "${NAME} settings"`,
  ].join('\n');
}

async function main() {
  const mode = process.argv.find((argument) => argument.startsWith('--')) ?? '--check';
  if (mode === '--rows-on' || mode === '--rows-off') {
    const result = managed.setSidebarRows(mode === '--rows-on');
    console.log(result.message);
    if (result.changed) console.log('run `herdr server reload-config` to pick up the change');
    process.exit(result.ok ? 0 : 1);
  }
  if (mode === '--apply' || mode === '--uninstall') {
    // Uninstall stops the daemon before the blocks go: a detached daemon
    // outlives `plugin uninstall`, and Herdr has no uninstall hook to stop it
    // from, so this action is the one place the whole teardown can happen.
    // Every token goes too — with the blocks gone nothing renders them.
    if (mode === '--uninstall') {
      console.log((await stopAnimator({ purge: true })) ? 'daemon: stopped, tokens cleared' : 'daemon: still running, tokens cleared');
    }
    const result = mode === '--apply' ? managed.apply() : managed.remove();
    console.log(result.message);
    // `--reload` is what the manifest actions pass: a user who installed from
    // GitHub never sees this directory, so the action has to finish the job.
    if (process.argv.includes('--reload')) {
      reloadConfig();
      console.log('herdr: config reloaded');
    } else {
      console.log('run `herdr server reload-config` to pick up the change');
    }
    process.exit(result.ok || mode === '--uninstall' ? 0 : 1);
  }
  if (mode === '--keys') {
    console.log(keybindings());
    return;
  }
  const report = managed.inspect();
  const has = (start) => (report.text?.includes(start) ? 'installed' : 'absent');
  console.log(`herdr   ${report.state.padEnd(16)} ${report.file}`);
  console.log(`theme   ${has(managed.THEME_START).padEnd(16)} [theme.custom]`);
  console.log(`sidebar ${has(managed.SIDEBAR_START).padEnd(16)} [ui.sidebar.*]`);
  console.log(`state   ${''.padEnd(16)} ${stateRoot}`);
}

main();
