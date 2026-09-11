'use strict';

// Install the icon font for the current user and, where a terminal keeps a
// plain-text config at a known place, map the plugin's codepoints to it.
//
// Per-user font directories need no elevation on any of the three platforms:
// macOS and Linux just take the file; Windows takes the file plus one value
// under HKCU (the "install for me" that Windows 10 added). The installed copy
// is named by content hash, so a rebuilt font never has to overwrite a file a
// running terminal holds open — the old copy is left until nothing locks it.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const identity = require('./identity');

const FONT_FAMILY = 'Herdr Agent Icons Max';
const SOURCE = path.join(__dirname, '..', 'dist', 'HerdrAgentIconsMax-Regular.ttf');
const BASENAME = 'HerdrAgentIconsMax';
const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts';
const REG_VALUE = `${FONT_FAMILY} (TrueType)`;
// The two codepoint ranges the font owns: vendor logos and state marks.
const RANGES = [
  ['E1A0', 'E1B3'],
  // Lifecycle marks, and the twelve throbber frames right behind them.
  ['E1C0', 'E1D1'],
];

function userFontDir() {
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Fonts');
  if (process.platform === 'win32') {
    return path.join(
      process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'),
      'Microsoft',
      'Windows',
      'Fonts',
    );
  }
  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'), 'fonts');
}

function sourceHash() {
  return crypto.createHash('sha256').update(fs.readFileSync(SOURCE)).digest('hex').slice(0, 8);
}

// Every copy of our font in the user font directory, ours by name.
function installedCopies() {
  try {
    return fs
      .readdirSync(userFontDir())
      .filter((name) => name.startsWith(BASENAME) && name.endsWith('.ttf'))
      .map((name) => path.join(userFontDir(), name));
  } catch {
    return [];
  }
}

// The copy that matches the font shipped here, or null.
function installedPath() {
  const target = path.join(userFontDir(), `${BASENAME}-${sourceHash()}.ttf`);
  return fs.existsSync(target) ? target : null;
}

function isInstalled() {
  return installedPath() !== null;
}

function reg(args) {
  return spawnSync('reg', args, { encoding: 'utf8', windowsHide: true, timeout: 10000 });
}

function install() {
  const notes = [];
  const dir = userFontDir();
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${BASENAME}-${sourceHash()}.ttf`);
  if (!fs.existsSync(target)) {
    fs.copyFileSync(SOURCE, target);
    notes.push(`font: installed ${target}`);
  } else {
    notes.push(`font: already installed (${path.basename(target)})`);
  }

  if (process.platform === 'win32') {
    // Per-user registration: one value naming the file. Re-pointing it is
    // how a rebuilt font takes over while a terminal still locks the old file.
    const result = reg(['add', REG_KEY, '/v', REG_VALUE, '/t', 'REG_SZ', '/d', target, '/f']);
    notes.push(result.status === 0 ? 'font: registered for this user (HKCU)' : `font: registry write failed: ${(result.stderr || '').trim()}`);
  } else if (process.platform === 'linux') {
    const result = spawnSync('fc-cache', ['-f', dir], { encoding: 'utf8', timeout: 30000 });
    notes.push(result.status === 0 ? 'font: fontconfig cache refreshed' : 'font: fc-cache not run (fontconfig missing?)');
  }

  // Older copies from previous builds: remove the ones nothing holds open.
  for (const file of installedCopies()) {
    if (file === target) continue;
    try {
      fs.rmSync(file);
      notes.push(`font: removed old ${path.basename(file)}`);
    } catch {
      notes.push(`font: ${path.basename(file)} is in use, left for now (restart the terminal and run again)`);
    }
  }
  return notes;
}

function uninstall() {
  const notes = [];
  if (process.platform === 'win32') {
    const result = reg(['delete', REG_KEY, '/v', REG_VALUE, '/f']);
    if (result.status === 0) notes.push('font: registry value removed');
  }
  for (const file of installedCopies()) {
    try {
      fs.rmSync(file);
      notes.push(`font: removed ${path.basename(file)}`);
    } catch {
      notes.push(`font: ${path.basename(file)} is in use, remove it after restarting the terminal`);
    }
  }
  if (process.platform === 'linux') spawnSync('fc-cache', ['-f', userFontDir()], { timeout: 30000 });
  if (notes.length === 0) notes.push('font: nothing installed');
  return notes;
}

/* --------------------------------------------------------- terminals */

// Terminals whose config is a plain-text file at a known path, and the lines
// that map our codepoints to the font. Only files that already exist are
// touched, inside a marker-fenced block, the same way Herdr's config is.
const TERMINALS = [
  {
    name: 'ghostty',
    // Ghostty reads `config` and, on macOS, also `config.ghostty` from the
    // same directories; a user who created the file from Finder has the
    // latter and nothing else.
    files: ['config', 'config.ghostty'].flatMap((name) => [
      path.join(os.homedir(), 'Library', 'Application Support', 'com.mitchellh.ghostty', name),
      path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'ghostty', name),
    ]),
    lines: [
      `font-family = "${FONT_FAMILY}"`,
      ...RANGES.map(([a, b]) => `font-codepoint-map = U+${a}-U+${b}="${FONT_FAMILY}"`),
    ],
    reload: 'reload the config (cmd+shift+, on macOS) or reopen the terminal',
  },
  {
    name: 'kitty',
    files: [path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'kitty', 'kitty.conf')],
    lines: RANGES.map(([a, b]) => `symbol_map U+${a}-U+${b} ${FONT_FAMILY}`),
    reload: 'reload the config (ctrl+shift+f5) or reopen the terminal',
  },
];

const markers = identity.markers('font');

function block(lines) {
  return [markers.start, ...lines, markers.end].join('\n');
}

function upsert(text, body) {
  const pattern = new RegExp(`\\n*${escape(markers.start)}[\\s\\S]*?${escape(markers.end)}`);
  if (pattern.test(text)) return text.replace(pattern, `\n\n${body}`);
  return `${text.replace(/\n+$/, '')}\n\n${body}\n`;
}

function drop(text) {
  return text.replace(new RegExp(`\\n*${escape(markers.start)}[\\s\\S]*?${escape(markers.end)}\\n*`), '\n').replace(/\n{3,}/g, '\n\n');
}

function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Write the mapping into every terminal config found. Returns notes.
function configureTerminals() {
  const notes = [];
  let found = false;
  for (const terminal of TERMINALS) {
    for (const file of terminal.files) {
      if (!fs.existsSync(file)) continue;
      found = true;
      const text = fs.readFileSync(file, 'utf8');
      const next = upsert(text, block(terminal.lines));
      if (next !== text) {
        fs.writeFileSync(file, next, 'utf8');
        notes.push(`${terminal.name}: codepoint map written to ${file} — ${terminal.reload}`);
      } else {
        notes.push(`${terminal.name}: codepoint map already in ${file}`);
      }
    }
  }
  if (!found) {
    notes.push(
      'terminal: no ghostty/kitty config found. Point your terminal at the font by codepoint:',
      ...RANGES.map(([a, b]) => `  U+${a}-U+${b} -> "${FONT_FAMILY}"`),
      '  (tty7: add the family to font_fallbacks; Windows Terminal / iTerm: no codepoint map, use the merged font instead)',
    );
  }
  return notes;
}

function unconfigureTerminals() {
  const notes = [];
  for (const terminal of TERMINALS) {
    for (const file of terminal.files) {
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, 'utf8');
      if (!text.includes(markers.start)) continue;
      fs.writeFileSync(file, drop(text), 'utf8');
      notes.push(`${terminal.name}: codepoint map removed from ${file}`);
    }
  }
  return notes;
}

module.exports = {
  FONT_FAMILY,
  RANGES,
  userFontDir,
  installedPath,
  isInstalled,
  install,
  uninstall,
  configureTerminals,
  unconfigureTerminals,
};
