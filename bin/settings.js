#!/usr/bin/env node
'use strict';

require('../lib/node-version');

// The settings popup: every key of the plugin's config.toml, edited in place.
//
//   node bin/settings.js          run the editor (Herdr opens it as a popup)
//   node bin/settings.js --open   ask Herdr to open the popup (the action)
//
// Herdr has no settings hook for plugins, so this is a small TUI of our own,
// shaped like Herdr's settings popup: one row per key, arrows to move and
// change, one key to save. Saving rewrites only the lines that changed — the
// user's comments and ordering survive — and restarts the daemon, which reads
// its config once at start.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const config = require('../lib/config');
const palette = require('../lib/palette');
const control = require('../lib/control');
const state = require('../lib/state');
const view = require('../lib/view');
const managed = require('../lib/managed-config');
const { detachedNode } = require('../lib/spawn');
const { pluginId, pluginConfigDir, ensureDir, stateRoot } = require('../lib/paths');
const { editTopLevel, editTable, writeAtomic } = require('../lib/toml-blocks');
const identity = require('../lib/identity');

/* ------------------------------------------------------------ the schema */

// The order row's words, and the lib/view.js modes they stand for. `off` is
// Herdr's own order — the plugin's rows stay, only the sort override goes.
const ORDER_MODE = { active: 'grouped', recent: 'recent', off: null };
const MODE_ORDER = { grouped: 'active', recent: 'recent', null: 'off' };

// Whether the plugin's sidebar rows are installed — the managed block's
// presence in Herdr's config IS that state (lib/managed-config.js).
function panelValue() {
  return managed.inspect().text?.includes(managed.SIDEBAR_START) ? 'plugin' : 'herdr';
}

// The persisted order choice (lib/view.js), as the row's word.
function orderValue() {
  return MODE_ORDER[view.mode()];
}

// One entry per key the plugin reads (lib/config.js). `table` is the TOML
// table the key lives in; absent means top level. A `virtual` field is not a
// config key at all but live state, read by its `read` and switched from here
// on save — the same two things the view keys switch, so a key press and this
// popup never disagree about what the current state is.
const FIELDS = [
  {
    key: 'agents_panel',
    kind: 'enum',
    options: ['plugin', 'herdr'],
    fallback: 'plugin',
    virtual: true,
    read: panelValue,
    help: "Whose Agents panel: the plugin's rows and order, or Herdr's own. Rarely changed, so it lives here, not on a key.",
  },
  {
    key: 'order',
    kind: 'enum',
    options: ['active', 'recent', 'off'],
    fallback: 'active',
    virtual: true,
    read: orderValue,
    help: "Agents panel order: active (grouped, busiest first, stale last), recent (flat, by activity) or off (Herdr's own order). Applies while agents_panel is plugin.",
  },
  {
    key: 'variant',
    kind: 'enum',
    options: ['auto', 'font', 'text', 'none'],
    fallback: 'auto',
    help: 'Vendor logos and state marks from the icon font, plain Unicode, or none. auto asks fontconfig (Linux only).',
  },
  {
    key: 'done_hold',
    kind: 'enum',
    options: ['until_seen', 6, 15, 30, 60, 120],
    fallback: 'until_seen',
    help: 'How long the done tick stays: until you focus the pane, or a number of seconds.',
  },
  { key: 'blocked_hold', kind: 'bool', fallback: true, help: 'Keep the question mark until the agent works again.' },
  {
    key: 'idle_grace_seconds',
    kind: 'number',
    step: 0.5,
    min: 0,
    max: 30,
    fallback: 2.5,
    help: 'Idle must persist this long before a turn counts as ended (absorbs detection flicker).',
  },
  {
    key: 'activity_fresh_minutes',
    kind: 'number',
    step: 5,
    min: 1,
    max: 1440,
    fallback: 15,
    help: 'An idle pane reads as fresh for this long after its last turn.',
  },
  {
    key: 'activity_stale_minutes',
    kind: 'number',
    step: 30,
    min: 1,
    max: 10080,
    fallback: 120,
    help: 'After this long without a turn an idle pane fades to stale.',
  },
  { key: 'group_indent', kind: 'number', step: 1, min: 0, max: 8, fallback: 2, help: 'Spaces members sit in under a workspace header; 0 = flat list.' },
  { key: 'group_gap', kind: 'bool', fallback: true, help: 'A blank row between workspace groups.' },
  { key: 'show_tab', kind: 'bool', fallback: false, help: 'Show the tab number on the state line.' },
  {
    key: 'worktree_mark',
    kind: 'glyph',
    fallback: '\uf418',
    help: 'The mark on a worktree header, after the branch corner. Enter a codepoint like U+F418, or empty for none.',
  },
  {
    key: 'follow_appearance',
    kind: 'bool',
    fallback: true,
    help: "Follow the desktop's light/dark and switch Herdr's theme with it (once a minute).",
  },
  {
    key: 'active_row_bg_light',
    table: 'colors',
    kind: 'color',
    fallback: palette.chrome.light.active_row_bg,
    help: 'Selected-row fill written to [theme.custom] for a light theme. Empty = keep the theme\'s own.',
  },
  {
    key: 'active_row_bg_dark',
    table: 'colors',
    kind: 'color',
    fallback: palette.chrome.dark.active_row_bg,
    help: 'Selected-row fill for a dark theme. Empty = keep the theme\'s own.',
  },
];

/* --------------------------------------------------------------- config */

function configFile() {
  const dir = process.env.HERDR_PLUGIN_CONFIG_DIR ?? pluginConfigDir(pluginId());
  return path.join(dir, 'config.toml');
}

function readConfig() {
  try {
    return fs.readFileSync(configFile(), 'utf8');
  } catch {
    return '';
  }
}

function currentValues(text) {
  const raw = config.parseToml(text);
  const values = new Map();
  for (const field of FIELDS) {
    if (field.virtual) {
      values.set(field, field.read());
      continue;
    }
    const holder = field.table ? raw[field.table] ?? {} : raw;
    values.set(field, holder[field.key]);
  }
  return values;
}

// The Agents panel's two layers, in the order `agent-view --native` uses:
// rows first (config rewrite + reload, only when the panel choice changed),
// then the sort override, then the persisted choice. Herdr's own panel has
// no override at all, so `order` only means something while the rows are
// the plugin's; with the panel set to herdr the order is off, whatever the
// row said.
async function applyView({ panelOn, panelChanged, order }) {
  if (panelChanged) view.setRows(panelOn);
  const mode = panelOn ? ORDER_MODE[order] : null;
  const reply = mode ? await view.apply(mode) : await view.clear();
  if (!reply || reply.error) throw new Error('could not switch the Agents panel order');
  view.setMode(mode);
}

// TOML text for a value: numbers bare, everything else double-quoted.
function literal(value) {
  return typeof value === 'number' || typeof value === 'boolean' ? String(value) : `"${value}"`;
}

function saveValues(text, values) {
  const top = {};
  const tables = {};
  for (const [field, value] of values) {
    if (value === undefined || field.virtual) continue;
    if (field.table) (tables[field.table] ??= {})[field.key] = literal(value);
    else top[field.key] = literal(value);
  }
  let next = editTopLevel(text, top);
  for (const [table, edits] of Object.entries(tables)) {
    const edited = editTable(next, table, edits);
    next = edited ?? `${next.replace(/\n*$/, '')}\n\n[${table}]\n${Object.entries(edits).map(([k, v]) => `${k} = ${v}`).join('\n')}\n`;
  }
  const file = configFile();
  ensureDir(path.dirname(file));
  writeAtomic(file, next, identity.TMP_SUFFIX);
}

/* ------------------------------------------------------------- display */

const R = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const INV = '\x1b[7m';
const ACCENT = '\x1b[38;5;110m';
const WARN = '\x1b[38;5;179m';

function codepoint(ch) {
  return ch ? `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}` : '';
}

function show(field, value) {
  // Not set in the file: say what the default is, not just that it applies.
  if (value === undefined) return `${DIM}${show(field, field.fallback).replace(/\x1b\[[0-9;]*m/g, '')}  (default)${R}`;
  switch (field.kind) {
    case 'bool':
      return value ? 'on' : 'off';
    case 'glyph':
      return value === '' ? `${DIM}none${R}` : `${codepoint(value)}  ${value}`;
    case 'color':
      return value === '' ? `${DIM}theme's own${R}` : String(value);
    default:
      return String(value);
  }
}

function width(s) {
  let w = 0;
  for (const ch of s.replace(/\x1b\[[0-9;]*m/g, '')) w += /[ᄀ-ᇿ⺀-꓏가-힣豈-﫿︰-﹏＀-￯]/.test(ch) ? 2 : 1;
  return w;
}

const pad = (s, n) => s + ' '.repeat(Math.max(0, n - width(s)));

// Break a sentence at spaces so no line exceeds `cols`. The terminal would
// wrap it anyway, but mid-word and without the row's leading indent; a popup
// this narrow needs the break chosen, not suffered.
function wrap(text, cols) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && width(line) + 1 + width(word) > cols) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// The help sits in a fixed number of rows so the hint line below it does not
// jump as the cursor moves between short and long descriptions.
const HELP_ROWS = 2;

/* ---------------------------------------------------------------- editor */

class Editor {
  constructor() {
    this.text = readConfig();
    this.saved = currentValues(this.text);
    this.values = new Map(this.saved);
    this.cursor = 0;
    this.editing = null; // { buffer } while typing a text value
    this.status = '';
    this.quitArmed = false;
  }

  get field() {
    return FIELDS[this.cursor];
  }

  effective(field) {
    const v = this.values.get(field);
    return v === undefined ? field.fallback : v;
  }

  dirty() {
    for (const field of FIELDS) if (this.values.get(field) !== this.saved.get(field)) return true;
    return false;
  }

  // Step the current field's value by direction (-1 / +1).
  step(dir) {
    const field = this.field;
    const cur = this.effective(field);
    if (field.kind === 'bool') return this.values.set(field, !cur);
    if (field.kind === 'enum') {
      const i = field.options.findIndex((o) => o === cur);
      const n = field.options.length;
      return this.values.set(field, field.options[((i < 0 ? 0 : i) + dir + n) % n]);
    }
    if (field.kind === 'number') {
      const next = Math.round((Number(cur) + dir * field.step) * 100) / 100;
      return this.values.set(field, Math.min(field.max, Math.max(field.min, next)));
    }
    return this.beginEdit();
  }

  beginEdit() {
    const field = this.field;
    const cur = this.effective(field);
    const buffer = field.kind === 'glyph' ? codepoint(cur) : String(cur);
    this.editing = { buffer };
  }

  commitEdit() {
    const field = this.field;
    const raw = this.editing.buffer.trim();
    this.editing = null;
    if (field.kind === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n)) return (this.status = `${WARN}not a number${R}`);
      return this.values.set(field, Math.min(field.max, Math.max(field.min, n)));
    }
    if (field.kind === 'glyph') {
      if (raw === '') return this.values.set(field, '');
      const hex = raw.match(/^U\+?([0-9a-f]{4,6})$/i)?.[1];
      const value = hex ? String.fromCodePoint(parseInt(hex, 16)) : [...raw][0];
      return this.values.set(field, value);
    }
    if (field.kind === 'color') {
      if (raw !== '' && !/^(#[0-9a-f]{6}|#[0-9a-f]{3}|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)|[a-z]+)$/i.test(raw)) {
        return (this.status = `${WARN}not a colour (hex, rgb(...) or a name)${R}`);
      }
      return this.values.set(field, raw);
    }
    this.values.set(field, raw);
  }

  async save() {
    if (!this.dirty()) return (this.status = 'nothing changed');
    const panel = FIELDS.find((f) => f.key === 'agents_panel');
    const order = FIELDS.find((f) => f.key === 'order');
    const changed = (f) => this.values.get(f) !== this.saved.get(f);
    const viewChanged = changed(panel) || changed(order);
    const viewWanted = {
      panelOn: this.effective(panel) === 'plugin',
      panelChanged: changed(panel),
      order: this.effective(order),
    };
    try {
      saveValues(this.text, this.values);
    } catch (error) {
      return (this.status = `${WARN}write failed: ${error.message}${R}`);
    }
    this.status = 'saved · restarting the daemon…';
    this.render();
    // The daemon reads its config once at start; restart it. Stop over the
    // pipe (it clears its tokens and exits), switch the panel while nothing
    // is painting, then start a fresh one with the environment Herdr gave this
    // popup, config directory included.
    const reply = await control.request({ cmd: 'stop' }, 10000);
    const deadline = Date.now() + 4000;
    while (reply?.ok && state.animatorRunning() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    let note = '';
    if (viewChanged) {
      try {
        await applyView(viewWanted);
      } catch (error) {
        note = ` · ${WARN}${error.message}${R}`;
      }
    }
    detachedNode(path.join(__dirname, 'agent-state.js'));
    this.text = readConfig();
    this.saved = currentValues(this.text);
    this.values = new Map(this.saved);
    this.status = `saved to ${configFile()} · daemon restarted${note}`;
  }

  render() {
    const cols = Math.max(60, (process.stdout.columns || 84) - 2);
    const keyW = 24;
    const out = [''];
    // Title left, plugin id right, the gap between them measured — not
    // guessed — so the pair fits the popup's width exactly and never wraps.
    const title = `${identity.NAME} settings`;
    const id = pluginId();
    out.push(` ${BOLD}${title}${R}${DIM}${' '.repeat(Math.max(1, cols - 1 - width(title) - width(id)))}${id}${R}`);
    out.push('');
    FIELDS.forEach((field, i) => {
      const selected = i === this.cursor;
      const changed = this.values.get(field) !== this.saved.get(field);
      const name = field.table ? `${field.table}.${field.key}` : field.key;
      const value =
        selected && this.editing ? `${INV}${this.editing.buffer}${R}${DIM}▏${R}` : show(field, this.values.get(field));
      const marker = changed ? `${WARN}*${R}` : ' ';
      const row = `${marker} ${pad(name, keyW)} ${value}`;
      out.push(selected ? ` ${ACCENT}▸${R} ${BOLD}${row}${R}` : `   ${row}`);
    });
    out.push('');
    const help = wrap(this.field.help, cols - 1).slice(0, HELP_ROWS);
    while (help.length < HELP_ROWS) help.push('');
    for (const line of help) out.push(` ${DIM}${line}${R}`);
    out.push('');
    out.push(
      this.editing
        ? ` ${DIM}type a value · ↵ confirm · esc cancel${R}`
        : ` ${DIM}↑↓ select · ←→ change · ↵ edit · r default · s save & apply · q close${R}`,
    );
    if (this.status) out.push(` ${this.status}`);
    process.stdout.write('\x1b[2J\x1b[H' + out.join('\n') + '\n');
  }

  async key(k) {
    this.status = '';
    if (this.editing) {
      if (k === '\r') this.commitEdit();
      else if (k === '\x1b') this.editing = null;
      else if (k === '\x7f' || k === '\b') this.editing.buffer = this.editing.buffer.slice(0, -1);
      else if (k >= ' ' && !k.startsWith('\x1b')) this.editing.buffer += k;
      return this.render();
    }
    if (k === 'q' || k === '\x1b' || k === '\x03') {
      if (this.dirty() && !this.quitArmed) {
        this.quitArmed = true;
        this.status = `${WARN}unsaved changes — q again to discard, s to save${R}`;
        return this.render();
      }
      process.stdout.write('\x1b[2J\x1b[H');
      process.exit(0);
    }
    this.quitArmed = false;
    if (k === '\x1b[A' || k === 'k') this.cursor = (this.cursor + FIELDS.length - 1) % FIELDS.length;
    else if (k === '\x1b[B' || k === 'j') this.cursor = (this.cursor + 1) % FIELDS.length;
    else if (k === '\x1b[C' || k === 'l' || k === ' ' || k === '+') this.step(1);
    else if (k === '\x1b[D' || k === 'h' || k === '-') this.step(-1);
    else if (k === '\r') this.field.kind === 'bool' || this.field.kind === 'enum' ? this.step(1) : this.beginEdit();
    else if (k === 'r') this.values.set(this.field, undefined);
    else if (k === 's') await this.save();
    this.render();
  }
}

/* ----------------------------------------------------------------- main */

function openPopup() {
  const herdr = process.env.HERDR_BIN_PATH ?? 'herdr';
  // `--cwd` is not optional on Windows: left to Herdr, the pane's cwd is the
  // plugin root as an extended-length `\\?\C:\...` path, which a Git Bash
  // pane shell cannot enter — the pane exits in ~40 ms before `node` ever
  // runs, and the popup just flashes. A plain path from here works everywhere.
  const root = path.resolve(__dirname, '..');
  const result = spawnSync(
    herdr,
    ['plugin', 'pane', 'open', '--plugin', pluginId(), '--entrypoint', 'settings', '--cwd', root],
    { encoding: 'utf8', windowsHide: true, timeout: 10000 },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || 'could not open the settings popup\n');
    process.exit(1);
  }
}

// A popup that dies takes its stderr with it, so anything fatal also goes to
// a file next to the daemon's log.
function crashLog(text) {
  try {
    fs.appendFileSync(path.join(ensureDir(stateRoot), 'settings.err'), `${new Date().toISOString()} ${text}\n`);
  } catch {
    // Nothing else to do.
  }
}

function main() {
  if (process.argv.includes('--open')) return openPopup();
  if (!process.stdin.isTTY) {
    crashLog(`no tty: stdin.isTTY=${process.stdin.isTTY} stdout.isTTY=${process.stdout.isTTY} cwd=${process.cwd()}`);
    console.error('settings: needs a terminal (Herdr opens it as a popup; try --open)');
    process.exit(1);
  }
  const editor = new Editor();
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (k) => {
    editor.key(String(k)).catch((error) => {
      editor.status = `${WARN}${error.message}${R}`;
      editor.render();
    });
  });
  process.stdout.on('resize', () => editor.render());
  editor.render();
}

process.on('uncaughtException', (error) => {
  crashLog(error?.stack ?? String(error));
  process.exit(1);
});
process.on('unhandledRejection', (error) => {
  crashLog(error?.stack ?? String(error));
  process.exit(1);
});

try {
  main();
} catch (error) {
  crashLog(error?.stack ?? String(error));
  throw error;
}
