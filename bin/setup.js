#!/usr/bin/env node
'use strict';

require('../lib/node-version');

// Install-time setup, run by the manifest's `[[build]]` hook when Herdr
// installs the plugin from GitHub, and available by hand:
//
//   node bin/setup.js            managed blocks + font + terminal map, then start the daemon
//   node bin/setup.js --force    redo the setup even if it was done before
//
// The daemon launcher (bin/agent-state.js) runs the same checks on every
// startup, so a plugin linked from a checkout — where no build hook runs —
// sets itself up on the first Herdr start instead.

const setup = require('../lib/setup');
const { detachedNode } = require('../lib/spawn');
const state = require('../lib/state');
const path = require('node:path');

const notes = setup.ensure({ force: process.argv.includes('--force') });
for (const note of notes) console.log(note);
if (notes.length === 0) console.log('setup: nothing to do');

if (!state.animatorRunning()) {
  detachedNode(path.join(__dirname, 'agent-state.js'));
  console.log('daemon: started');
}
