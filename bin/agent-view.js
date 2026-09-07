#!/usr/bin/env node
'use strict';

require('../lib/node-version');

// Cycle the Agents panel between this plugin's orders and Herdr's own.
//
//   node bin/agent-view.js            cycle: off -> active -> recent -> off
//   node bin/agent-view.js --flip     active <-> recent (never lands on off)
//   node bin/agent-view.js --native   everything Herdr's way <-> everything ours
//   node bin/agent-view.js --active   grouped, both levels by last activity
//   node bin/agent-view.js --recent   flat, every pane by last activity
//   node bin/agent-view.js --off      back to Herdr's own order
//   node bin/agent-view.js --reapply  startup: restore whatever was chosen
//
// This is a THIN CLIENT: the resident daemon (agent-state.js --animate) does
// the actual switch over its control pipe — apply the override, persist the
// choice, repaint on its next wake — so the hot path costs one pipe roundtrip
// on top of this process's own startup. When no daemon answers (not started
// yet, or too old), the standalone path below does everything itself, exactly
// as before daemons existed.
//
// Herdr disables the panel's grouped/priority toggle while any override is
// active, so this script is the way in AND the way out — bind it to a key via
// a plugin_action custom command, or run the plugin's actions.
//
// `--native` is the only mode that touches BOTH layers of the panel: the sort
// override here and the `[ui.sidebar.*]` rows in config.toml (lib/view.js
// setRows). The others switch the order and leave the look alone — "native"
// that still painted our logos and colours was not what anyone meant by it.

const path = require('node:path');

const view = require('../lib/view');
const control = require('../lib/control');
const { pluginConfigDir } = require('../lib/paths');
const { pluginId } = require('../lib/herdr');
const { detachedNode } = require('../lib/spawn');

const SAID = {
  grouped: 'agent view: active (grouped, recent first)',
  recent: 'agent view: recent (flat)',
  null: 'agent view: back to panel order',
};

// Fallback only: with no daemon there is nobody to repaint, so start one.
// Plugin-action runs carry the config-dir env; a bare shell run derives it so
// the daemon does not fall back to the wrong glyph variant.
function wakeAnimator() {
  const env = { ...process.env };
  if (!env.HERDR_PLUGIN_CONFIG_DIR) env.HERDR_PLUGIN_CONFIG_DIR = pluginConfigDir(pluginId());
  detachedNode(path.join(__dirname, 'agent-state.js'), [], { env });
}

async function standalone(flag, message, current) {
  const next = view.resolve(current, message);

  // Rows first, override second — see lib/view.js setRows. A failed socket call
  // below therefore leaves the look switched and the order not; pressing again
  // is the fix, and the alternative ordering can lose the override silently.
  if (flag === '--native') view.setRows(Boolean(next));

  const reply = next ? await view.apply(next) : await view.clear();
  if (!reply || reply.error) {
    console.log(
      `agent view: ${next ? 'set' : 'clear'} failed${reply?.error ? ` (${reply.error.code})` : ''}`,
    );
    process.exitCode = 1;
    return;
  }
  if (flag !== '--reapply') view.setMode(next);
  wakeAnimator();
  console.log(SAID[next]);
}

async function main() {
  const flag = process.argv.find((argument) => argument.startsWith('--')) ?? '--cycle';
  const current = view.mode();
  // Off is the one choice with nothing to restore. Never chosen counts as
  // `active` (lib/view.js DEFAULT_MODE), so a fresh install sorts by activity
  // from the first server start.
  if (flag === '--reapply' && !current) return;

  const message =
    flag === '--flip'
      ? { cmd: 'view', op: 'flip' }
      : flag === '--native'
        ? { cmd: 'view', op: 'native' }
        : flag === '--active'
          ? { cmd: 'view', set: 'grouped' }
          : flag === '--recent'
            ? { cmd: 'view', set: 'recent' }
            : flag === '--off'
              ? { cmd: 'view', set: 'off' }
              : flag === '--reapply'
                ? { cmd: 'view', set: current }
                : { cmd: 'view', op: 'cycle' };

  const reply = await control.request(message, 3000);
  if (reply?.ok && reply.applied) {
    console.log(SAID[reply.mode]);
    return;
  }
  await standalone(flag, message, current);
}

main();
