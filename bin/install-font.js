#!/usr/bin/env node
'use strict';

require('../lib/node-version');

// Install the icon font for this user and map its codepoints in the terminal.
//
//   node bin/install-font.js              install the font, write the terminal mapping
//   node bin/install-font.js --check      what is installed, and where
//   node bin/install-font.js --uninstall  remove the font and the mapping
//
// The manifest actions `install-font` / `uninstall-font` run these, so a
// GitHub install never needs this directory.

const font = require('../lib/font');

function main() {
  const mode = process.argv.find((argument) => argument.startsWith('--')) ?? '--install';
  if (mode === '--check') {
    const installed = font.installedPath();
    console.log(`font    ${installed ? 'installed' : 'absent'}  ${installed ?? font.userFontDir()}`);
    return;
  }
  const notes = mode === '--uninstall' ? [...font.uninstall(), ...font.unconfigureTerminals()] : [...font.install(), ...font.configureTerminals()];
  for (const note of notes) console.log(note);
  if (mode !== '--uninstall') {
    console.log('done. New terminal windows pick the font up; some terminals need a full restart.');
  }
}

main();
