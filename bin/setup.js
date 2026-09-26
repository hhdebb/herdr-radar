#!/usr/bin/env node
'use strict';

require('../lib/node-version');

// Install-time setup, run by the manifest's `[[build]]` hook when Herdr
// installs the plugin from GitHub, and available by hand:
//
//   node bin/setup.js            managed blocks + font + terminal map
//   node bin/setup.js --force    redo the setup even if it was done before
//
// The daemon launcher (bin/agent-state.js) runs the same checks on every
// startup, so a plugin linked from a checkout — where no build hook runs —
// sets itself up on the first Herdr start instead.
//
// This script starts NOTHING. The build hook runs inside Herdr's temporary
// checkout, which Herdr renames into place once the hook is done — and a
// daemon started from here inherits that checkout as its working directory.
// On Windows a directory that is some process's cwd cannot be renamed, so
// the install failed with os error 32 on every Windows machine (#23). The
// daemon would also have been running from paths about to move. It starts
// from the startup hooks and the `state-start` action instead, once the
// plugin is where it will stay.

const setup = require('../lib/setup');

const notes = setup.ensure({ force: process.argv.includes('--force') });
for (const note of notes) console.log(note);
if (notes.length === 0) console.log('setup: nothing to do');
