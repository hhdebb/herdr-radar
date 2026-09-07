'use strict';

// First-run setup: everything `herdr plugin install` alone does not do.
//
// A freshly installed plugin shows nothing until its managed blocks are in
// Herdr's config and the icon font is where the terminal can find it. Rather
// than a README of steps, the daemon's launcher runs this once: on the first
// start it writes the blocks, installs the font and maps the codepoints in any
// ghostty/kitty config it finds, then leaves a stamp so a later start does not
// redo — or undo — what the user has since changed by hand. The stamp carries
// the font's content hash, so a release with a new font sets up again.

const fs = require('node:fs');
const path = require('node:path');

const { stateRoot, ensureDir } = require('./paths');
const identity = require('./identity');

function stamp() {
  return path.join(ensureDir(stateRoot), 'setup.done');
}

function expected() {
  let fontHash = 'none';
  try {
    fontHash = path.basename(require('./font').installedPath() ?? '').replace(/^.*-([0-9a-f]{8})\.ttf$/, '$1');
  } catch {
    // No font module means no font to install.
  }
  return `${identity.NAME} ${fontHash}`;
}

// Returns the notes of what was done; an empty list means nothing was needed.
function ensure({ force = false } = {}) {
  const notes = [];
  const managed = require('./managed-config');
  const font = require('./font');
  const { reloadConfig } = require('./herdr');

  let done = null;
  try {
    done = fs.readFileSync(stamp(), 'utf8').trim();
  } catch {
    // First run.
  }
  const fontMissing = !font.isInstalled();
  if (!force && done && !fontMissing) return notes;

  const report = managed.inspect();
  if (report.state === 'installable') {
    const result = managed.apply();
    notes.push(result.message);
    if (result.ok) {
      reloadConfig();
      notes.push('herdr: config reloaded');
    }
  } else if (report.state !== 'installed') {
    notes.push(`herdr: managed blocks not written (${report.state}); run the configure action once that is fixed`);
  }

  if (fontMissing) {
    notes.push(...font.install(), ...font.configureTerminals());
  }

  try {
    fs.writeFileSync(stamp(), `${identity.NAME} ${font.installedPath() ? path.basename(font.installedPath()) : 'no-font'}\n`, 'utf8');
  } catch {
    // Without a stamp the next start repeats the (idempotent) checks.
  }
  return notes;
}

module.exports = { ensure, stamp, expected };
