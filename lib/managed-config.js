'use strict';

// The three blocks this plugin owns inside Herdr's config.toml — the tab-bar
// entry in `[ui]`, the `[theme.custom]` override and the `[ui.sidebar.*]`
// rows — and the operations on them: inspect, install/repair, remove, and the
// appearance switch that rewrites the two that carry colours. Each block sits
// between a pair of marker comments; nothing outside the markers is touched.
// bin/configure.js is the command line over this module.

const fs = require('node:fs');
const path = require('node:path');

const { stateRoot, ensureDir, herdrConfigPath } = require('./paths');
const { escapeRegExp, tableValue, tableRaw, editTable, upsertTail, dropBlock, writeAtomic } = require('./toml-blocks');
const palette = require('./palette');
const logos = require('./logos');
const appearance = require('./appearance');
const config = require('./config');
const identity = require('./identity');

const TAB_BAR = identity.markers('tab-bar');
const BLOCK_START = TAB_BAR.start;
const BLOCK_END = TAB_BAR.end;
// The tab-bar block edits bare keys inside `[ui]`, so it must sit in that
// table. These two bring their own table headers and are appended at the end
// of the file instead: a header dropped in front of another table's bare keys
// silently adopts them (`theme.custom.name` and friends — Herdr then reports
// them as unknown keys).
const THEME = identity.markers('theme');
const THEME_START = THEME.start;
const THEME_END = THEME.end;
const SIDEBAR = identity.markers('sidebar');
const SIDEBAR_START = SIDEBAR.start;
const SIDEBAR_END = SIDEBAR.end;

// Blocks written under a previous name of this plugin: rename their markers
// so the normal refresh replaces them instead of leaving orphans beside the
// new ones. Applied to everything inspect() reads, so every write migrates.
function migrateMarkers(text) {
  let next = text;
  for (const old of identity.LEGACY_NAMES) {
    for (const block of ['tab-bar', 'theme', 'sidebar']) {
      const from = identity.markers(block, old);
      const to = identity.markers(block);
      next = next.split(from.start).join(to.start).split(from.end).join(to.end);
    }
  }
  return next;
}

// The tables the theme and sidebar blocks declare. TOML forbids declaring a
// table twice, so a copy the user wrote by hand outside our markers makes an
// appended block a parse error — and a config.toml that fails to parse takes
// every plugin down with it. Anything listed here is refused, never merged.
const THEME_TABLES = ['theme.custom'];
// `rows_by_agent` is NOT here: this plugin stopped declaring it in 2.0, so a
// hand-written one is a per-vendor override layered on our row, not a clash.
const SIDEBAR_TABLES = ['ui.sidebar.agents', 'ui.sidebar.spaces'];

// Those tables as they appear outside the managed blocks: the user's own.
function foreignTables(text, tables = [...THEME_TABLES, ...SIDEBAR_TABLES]) {
  let outside = dropBlock(text, THEME_START, THEME_END);
  outside = dropBlock(outside, SIDEBAR_START, SIDEBAR_END);
  return tables.filter((table) => new RegExp(`^\\[${escapeRegExp(table)}\\]\\s*$`, 'm').test(outside));
}

function refusal(tables) {
  return `herdr: refused — [${tables.join('], [')}] already written by hand; merge or remove it yourself`;
}

// What `[theme]` said before applyAppearance first touched it, so remove()
// can put it back. `name` and `auto_switch` live outside the markers — they
// are the user's keys, driven for the duration of the install — and a
// removal that left `auto_switch = false` behind would be a change nobody
// asked for. Recorded once, on first write; a missing key is recorded as
// null and deleted again on restore.
const THEME_ORIGIN = path.join(stateRoot, 'theme-origin.json');

function recordThemeOrigin(text) {
  if (fs.existsSync(THEME_ORIGIN)) return;
  ensureDir(stateRoot);
  const origin = { name: tableRaw(text, 'theme', 'name'), auto_switch: tableRaw(text, 'theme', 'auto_switch') };
  fs.writeFileSync(THEME_ORIGIN, `${JSON.stringify(origin, null, 2)}\n`, 'utf8');
}

function restoreThemeOrigin(text) {
  let origin;
  try {
    origin = JSON.parse(fs.readFileSync(THEME_ORIGIN, 'utf8'));
  } catch {
    return text;
  }
  const restored = editTable(text, 'theme', { name: origin.name ?? null, auto_switch: origin.auto_switch ?? null });
  fs.rmSync(THEME_ORIGIN, { force: true });
  return restored ?? text;
}

function posix(file) {
  return file.replace(/\\/g, '/');
}

function backup(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(stateRoot, 'backups', `${path.basename(file)}.${stamp}`);
  ensureDir(path.dirname(target));
  fs.copyFileSync(file, target);
  return target;
}

// Herdr runs the status command on a fixed timer and does *not* re-run it when
// focus changes, so this interval is the worst-case lag after switching tabs or
// workspaces. The command is a bare `type`/`cat` of the cache file the resident
// daemon keeps fresh (lib/tabline.js) — Herdr used to boot a whole node here
// every interval, which cost more CPU than everything the line ever showed.
// Herdr takes the last line of output; a dead daemon leaves a stale line, and
// a missing file makes the command fail, which hides the segment entirely.
function block(intervalSeconds = 2) {
  const cache = path.join(stateRoot, 'tabbar.txt');
  // TOML literal strings (single quotes) keep Windows backslashes out of the
  // escape parser. cmd's `type` needs backslashes — forward slashes read as
  // switches — so the path is NOT posix()ed on Windows.
  const command =
    process.platform === 'win32' ? `type "${cache}"` : `cat "${posix(cache)}"`;
  return [
    BLOCK_START,
    'tab_bar_right_separator = " · "',
    'tab_bar_right = [',
    `  { type = 'command', command = '${command}', interval_seconds = ${intervalSeconds}, timeout_seconds = 3 },`,
    ']',
    BLOCK_END,
  ].join('\n');
}

// Which side of the palette to use: light or dark, or null for "leave it".
function chromeVariant(text) {
  // With appearance following on, the desktop is the authority: bin/theme-sync.js
  // drives `[theme] name` from it, so the configured name is only a fallback
  // for a machine whose appearance we cannot read. With it off, the configured
  // name is the only input.
  const detected = config.followAppearance ? appearance.current() : null;
  if (detected) return detected;
  const name = tableValue(text, 'theme', 'name');
  if (!name || name === 'terminal') return null;
  return palette.lightThemes.includes(name) ? 'light' : 'dark';
}

// Put Herdr in the appearance we just detected: its own theme for that side,
// and the row fill to match. Returns changed:false when the file already says
// this, so callers can skip the reload.
//
// Herdr's `auto_switch` is deliberately turned off here rather than relied on.
// It queries the host terminal's background exactly once, in `App::run`, so it
// only ever notices an appearance change on the next attach — a theme that
// flips at dusk would sit wrong until you detached and came back. Driving
// `[theme] name` ourselves and reloading applies immediately. `light_name` and
// `dark_name` still express which pair to use: the config stays readable as
// Herdr's own, we just do the switching.
function applyAppearance(variant) {
  const report = inspect();
  if (!report.text) return { ok: false, changed: false, message: `herdr: ${report.state}` };
  if (!variant || !palette.chrome[variant]) {
    return { ok: false, changed: false, message: 'herdr: unknown appearance' };
  }
  // Hand-written copies of our tables, added since the install: theirs win.
  // Ours is dropped so the file parses again, and the theme name still
  // switches, which is the part that matters at dusk.
  const foreignTheme = foreignTables(report.text, THEME_TABLES).length > 0;
  const foreignSidebar = foreignTables(report.text, SIDEBAR_TABLES).length > 0;

  const wanted =
    tableValue(report.text, 'theme', variant === 'light' ? 'light_name' : 'dark_name') ??
    (variant === 'light' ? 'catppuccin-latte' : 'catppuccin');

  let next = editTable(report.text, 'theme', {
    name: `"${wanted}"`,
    auto_switch: 'false',
  });
  if (next === null) return { ok: false, changed: false, message: 'herdr: no [theme] table' };
  next = foreignTheme ? dropBlock(next, THEME_START, THEME_END) : withThemeBlock(next, variant);
  // Refresh the sidebar block, never install it: with the rows toggled off
  // (setSidebarRows) their ABSENCE is the state — nothing else records it — so
  // a desktop light/dark flip must not smuggle them back in behind the user.
  if (foreignSidebar) next = dropBlock(next, SIDEBAR_START, SIDEBAR_END);
  else if (next.includes(SIDEBAR_START)) next = upsertTail(next, SIDEBAR_START, SIDEBAR_END, sidebarBlock(variant));
  if (next === report.text) return { ok: true, changed: false, message: 'herdr: appearance current' };

  recordThemeOrigin(report.text);
  backup(report.file);
  writeAtomic(report.file, next, identity.TMP_SUFFIX);
  return { ok: true, changed: true, message: `herdr: ${variant} (${wanted})` };
}

// The chrome tokens for one appearance: the palette's defaults, with the
// user's `[colors]` overrides applied. An empty override drops the token, so
// the theme's own value shows through.
function chromeTokens(variant) {
  const tokens = { ...palette.chrome[variant] };
  const override = config.activeRowBg[variant];
  if (override !== undefined) {
    if (override) tokens.active_row_bg = override;
    else delete tokens.active_row_bg;
  }
  return tokens;
}

// The theme block, or null when there is nothing left to override.
function themeBlock(variant) {
  const tokens = chromeTokens(variant);
  if (Object.keys(tokens).length === 0) return null;
  const lines = [THEME_START, '[theme.custom]'];
  for (const [key, value] of Object.entries(tokens)) lines.push(`${key} = "${value}"`);
  lines.push(THEME_END);
  return lines.join('\n');
}

function withThemeBlock(text, variant) {
  const body = themeBlock(variant);
  return body ? upsertTail(text, THEME_START, THEME_END, body) : dropBlock(text, THEME_START, THEME_END);
}

function cell(token, fg, bold = false, dim = false) {
  return `{ token = "${token}", fg = "${fg}", bold = ${bold}, dim = ${dim} }`;
}

// Herdr 0.9 styles a token by what it SAYS: up to 16 ordered rules per cell,
// first match wins, and whatever a rule leaves out inherits the cell's own
// style. The logo's value is the vendor's glyph, so one cell now carries every
// vendor's colour — before 0.9 the only way to do that was to duplicate the
// entire row definition under `rows_by_agent`, once per vendor, which is why
// only three vendors ever had a colour of their own.
const RULE_LIMIT = 16;
// Herdr's own ceiling on how many tokens one sidebar row may name.
const ROW_TOKEN_LIMIT = 16;

// The rows of a generated `rows = [...]` body, split at bracket depth 1. A
// regex cannot do this: a cell's `rules = [...]` nests brackets inside the row
// it belongs to, and a pattern that stops at the first `]` counts a row as
// three.
function topLevelRows(body) {
  const rows = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character === '[') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === ']') {
      depth -= 1;
      if (depth === 0) rows.push(body.slice(start, index + 1));
    }
  }
  return rows;
}

// Tokens named in one row: the `token = "$x"` of a styled cell, plus the bare
// `"$x"` of an unstyled one. A rule's `equals = "..."` is not a token.
function tokensIn(row) {
  const styled = (row.match(/token = "/g) ?? []).length;
  const bare = (row.match(/(?<![:=] )"\$\w+"/g) ?? []).length;
  return styled + bare;
}

function logoCell(token, glyphs, { bold = false, dim = false } = {}) {
  const rules = Object.entries(palette.brand)
    .filter(([vendor]) => vendor !== 'other' && glyphs[vendor])
    .slice(0, RULE_LIMIT)
    // `contains`, not `equals`: the value is the mark with its indent in front
    // — a zero-width space and a couple of spaces for anything below a group
    // header — so an exact match only ever caught the first row of a group and
    // left every member wearing the fallback colour.
    .map(([vendor, fg]) => `{ contains = "${glyphs[vendor]}", fg = "${fg}" }`);
  // `other` is the cell's own colour rather than a rule: it is what an
  // unmatched glyph — a vendor with no hue, or none at all — should wear.
  const base = `token = "${token}", fg = "${palette.brand.other}", bold = ${bold}, dim = ${dim}`;
  return rules.length ? `{ ${base}, rules = [${rules.join(', ')}] }` : `{ ${base} }`;
}

// Which glyph table the rules above were written against. The rules match
// literal strings, so a block written for the icon font means nothing once the
// variant flips to plain Unicode — the daemon compares this line with what it
// resolves and rewrites the block when they disagree (lib/daemon.js).
const VARIANT_TAG = '# logo glyphs: ';

function blockVariant(text) {
  return new RegExp(`^${escapeRegExp(VARIANT_TAG)}(\\w+)$`, 'm').exec(text ?? '')?.[1] ?? null;
}

// Both sidebar lists, built from the same palette.
//
// Agents: the whole line (state mark + logo + name) is one token per state,
// because Herdr joins adjacent cells with `·` and one token means one colour —
// which is what carries the state here. The title row plays the same trick
// with the `$title_*` tokens so it dims and brightens with its state line —
// the built-in `terminal_title_stripped` cell could only ever be one static
// colour, which left a stale session's title as loud as a fresh one's.
// Titles stay unbolded even where the state line bolds: the mark line is a
// glyph, the title is prose. Spaces: the state mark and the vendor logos are
// separate cells so each can be coloured, and every extra cell costs a
// separator, so a Space running two or more vendors packs its logos into one.
// The freshness colours flip direction with the appearance, so the block is
// built per variant and rewritten by applyAppearance whenever the desktop
// flips — the same path that already rewrites the theme block.
function sidebarBlock(variant) {
  const { brand } = palette;
  const state = palette.stateFor(variant);
  // An entry is ONE row: `logo · title`. The vendor's name said what its
  // logo already said, and a state mark said what the title's colour now
  // says — two rows per session bought sixty rows for thirty sessions and no
  // information the first row lacked. The middot between the cells is Herdr's
  // own separator, unsuppressible, and here it falls between a mark and a
  // sentence, which is what a divider is for.
  //
  // Colour splits the same way: the logo is the vendor (its brand colour,
  // breathing while that session works), the title is the state (the
  // freshness scale, or a lifecycle colour when something needs you).
  const glyphs = logos.glyphs();
  const agentRow = () =>
    [
      // A synthesised parent for a worktree whose own checkout has no session
      // on the list — without it there is no pane to hang that name on and the
      // tree cannot stand up (lib/state.js writeGroups). Empty on every other
      // entry, where the row collapses. Dimmed on purpose: it names a repo that
      // has nothing running, so it should not read as loud as a live group.
      `[${[cell('$group_parent', state.idleStale, true, true)].join(', ')}]`,
      // The header fades with its workspace. When every session inside has
      // gone stale the name goes with them; leaving it at full strength put a
      // column of bright names over faded contents, which reads as damage
      // rather than as a project that is simply asleep.
      `[${[
        cell('$group', state.subtle, true),
        cell('$group_stale', state.idleStale, true, true),
      ].join(', ')}]`,
      `[${[
        // Four names for one glyph, because these three styles are not in the
        // value and a rule can only read the value. Working breathes: the
        // daemon alternates the two `working` names and the only difference is
        // `dim`. Using the terminal's own dim rather than a darker hex means
        // the pulse blends toward whatever is actually behind the panel — a
        // hand-picked colour cannot, since the direction that reads as faded
        // flips between a light and a dark theme, and neither knows about a
        // wallpaper showing through. A stale row's logo leaves the brand
        // behind entirely and greys out with everything else in the row.
        // Structure, not content: the same grey a stale group header wears, so
        // the corner holds the row without competing with it.
        cell('$split_mark', state.idleStale, false, true),
        logoCell('$logo', glyphs),
        // Working is the same glyph in the same colour, bolder — a rule reads
        // the value, and the value cannot say which state a row is in.
        logoCell('$logo_working', glyphs, { bold: true }),
        cell('$logo_stale', state.idleStale, false, true),
        // The title carries the state, and one warm colour says "working" for
        // every vendor: the brand is already on the glyph immediately to its
        // left, and repeating it here only made the two cells agree loudly.
        // Working is the one title that bolds. Titles are prose and prose does
        // not shout, but a panel of thirty rows is scanned, not read, and the
        // question it gets asked is always the same one: which of these is
        // still going? Weight answers that before colour does.
        cell('$title_working', brand.other, true),
        cell('$title_done', state.done),
        cell('$title_blocked', state.blocked),
        cell('$title_idle_fresh', state.idleFresh),
        cell('$title_idle', state.idleNormal),
        // Terminal dim is the closest thing to opacity a cell style has: most
        // terminals render it by blending toward the background, which is
        // exactly what "stop competing for attention" means on a panel whose
        // background no static hex can know.
        cell('$title_idle_stale', state.idleStale, false, true),
        cell('$title_unknown', state.unknown),
      ].join(', ')}]`,
      '["$gap"]',
    ].join(', ');

  // Herdr rejects a row with more than 16 tokens — and rejects the whole
  // config file with it, which takes every plugin down. Cheaper to find out
  // here: this is generated, so the count moves whenever the palette does.
  for (const row of topLevelRows(agentRow())) {
    const count = tokensIn(row);
    if (count > ROW_TOKEN_LIMIT) {
      throw new Error(`sidebar row would carry ${count} tokens; Herdr allows ${ROW_TOKEN_LIMIT}`);
    }
  }

  // Row one is the state mark and the name, and nothing else: the Spaces column
  // is narrow, and anything sharing that row truncates the very name it is
  // there to show. Row two carries the vendor logos, where Herdr's hanging
  // indent puts them under the name. The branch and its ahead/behind count used
  // to sit there — but a Space is picked by what is running in it, not by which
  // branch it happens to be on, and the agents were the thing with nowhere left
  // to go.
  const spaceMarks = [
    cell('$space_blocked', state.blocked, true),
    cell('$space_working_claude', brand.claude, true),
    cell('$space_working_codex', brand.codex, true),
    cell('$space_working_grok', brand.grok, true),
    cell('$space_working_other', brand.other, true),
    cell('$space_done', state.done, true),
    cell('$space_idle', state.idle),
    cell('$space_unknown', state.unknown),
    cell('$space_none', state.none),
    // The workspace name is a token we publish rather than Herdr's built-in
    // `workspace` cell, so the whole Spaces row is under the plugin's control
    // (colour today; anything rendered into the label tomorrow).
    cell('$space_label', state.none),
  ];
  const spaceLogos = [
    cell('$space_logo_claude', brand.claude),
    cell('$space_logo_codex', brand.codex),
    cell('$space_logo_grok', brand.grok),
    cell('$space_logo_other', state.subtle),
  ];

  return [
    SIDEBAR_START,
    '[ui.sidebar.agents]',
    `${VARIANT_TAG}${logos.resolveVariant()}`,
    // Every agent lands on this one row, and it has to be OUR row shape, not
    // Herdr's stock one. The stock rows put the workspace name on a line of
    // its own, which is indistinguishable from a group header — a cursor pane
    // in a workspace full of claude ones read as its own group, and its logo
    // never drew at all, because those rows ask for Herdr's builtin
    // `state_icon` and never look at `$logo`.
    //
    // `rows_by_agent` is gone with 0.9: it existed only to give each vendor a
    // colour, which the logo cell's value rules now do without a copy of the
    // whole layout per vendor.
    `rows = [${agentRow()}]`,
    '',
    '[ui.sidebar.spaces]',
    // No blank row between Spaces. `row_gap` is whole terminal rows, and one
    // of them is a lot of air beside a two-row entry — the logo row already
    // reads as the end of an entry.
    'row_gap = 0',
    `rows = [\n  [\n    ${spaceMarks.join(',\n    ')}\n  ],\n  [\n    ${spaceLogos.join(',\n    ')}\n  ]\n]`,
    SIDEBAR_END,
  ].join('\n');
}

function inspect() {
  const file = herdrConfigPath();
  if (!fs.existsSync(file)) return { file, state: 'missing' };
  const text = migrateMarkers(fs.readFileSync(file, 'utf8'));
  if (text.includes(BLOCK_START)) return { file, state: 'installed', text };
  if (/^\s*tab_bar_right\s*=/m.test(text)) return { file, state: 'foreign-entry', text };
  if (!/^\s*\[ui\]\s*$/m.test(text)) return { file, state: 'no-ui-table', text };
  const foreign = foreignTables(text);
  if (foreign.length) return { file, state: 'foreign-table', text, foreign };
  return { file, state: 'installable', text };
}

function apply() {
  const report = inspect();
  if (report.state === 'missing') return { ok: false, message: 'herdr: config.toml not found' };
  if (report.state === 'foreign-entry') {
    return { ok: false, message: 'herdr: refused — tab_bar_right is already set by hand; merge it yourself' };
  }
  if (report.state === 'no-ui-table') return { ok: false, message: 'herdr: refused — no [ui] table to extend' };
  if (report.state === 'foreign-table') return { ok: false, message: refusal(report.foreign) };
  // A refresh of an installed set can still collide with a table written by
  // hand since the install.
  const foreign = foreignTables(report.text);
  if (foreign.length) return { ok: false, message: refusal(foreign) };

  backup(report.file);
  let next =
    report.state === 'installed'
      ? report.text.replace(
          new RegExp(`${escapeRegExp(BLOCK_START)}[\\s\\S]*?${escapeRegExp(BLOCK_END)}`),
          block(),
        )
      : report.text.replace(/^(\s*\[ui\]\s*)$/m, `$1\n\n${block()}\n`);
  const variant = chromeVariant(report.text);
  next = variant ? withThemeBlock(next, variant) : dropBlock(next, THEME_START, THEME_END);
  next = upsertTail(next, SIDEBAR_START, SIDEBAR_END, sidebarBlock(variant ?? 'light'));
  writeAtomic(report.file, next, identity.TMP_SUFFIX);
  const themeNote = variant
    ? `theme (${variant})`
    : 'theme skipped — auto_switch or a host-following theme owns the colours';
  return {
    ok: true,
    message: `herdr: tab-bar, sidebar and ${themeNote} ${
      report.state === 'installed' ? 'refreshed' : 'installed'
    }`,
  };
}

// Install or remove ONLY the sidebar block — the `[ui.sidebar.*]` rows that
// paint the vendor logos, the state colours and the group headers. This is the
// rendering half of the Agents panel; `agent.view.set` (lib/view.js) reorders
// the rows, this decides whether the rows are ours at all.
//
// It exists apart from apply()/remove() because those two are install-time
// operations that also own the tab-bar and theme blocks: toggling the look on a
// keypress through remove() would take the tab bar and the colours down with
// it. Here the block's presence in config.toml IS the state — no flag file to
// drift out of step, and applyAppearance() above reads that same presence.
//
// The caller reloads (lib/view.js setRows does); nothing here is live until
// `herdr server reload-config` runs.
function setSidebarRows(on) {
  const report = inspect();
  if (!report.text) return { ok: false, changed: false, message: `herdr: ${report.state}` };
  if (report.text.includes(SIDEBAR_START) === on) {
    return { ok: true, changed: false, message: `herdr: sidebar rows already ${on ? 'on' : 'off'}` };
  }
  const foreign = on ? foreignTables(report.text, SIDEBAR_TABLES) : [];
  if (foreign.length) return { ok: false, changed: false, message: refusal(foreign) };
  const next = on
    ? upsertTail(
        report.text,
        SIDEBAR_START,
        SIDEBAR_END,
        sidebarBlock(chromeVariant(report.text) ?? 'light'),
      )
    : dropBlock(report.text, SIDEBAR_START, SIDEBAR_END);
  backup(report.file);
  writeAtomic(report.file, next, identity.TMP_SUFFIX);
  return { ok: true, changed: true, message: `herdr: sidebar rows ${on ? 'on' : 'off'}` };
}

function remove() {
  const report = inspect();
  if (!report.text) return { ok: false, message: `herdr: nothing to remove (${report.state})` };
  backup(report.file);
  let next = dropBlock(report.text, BLOCK_START, BLOCK_END);
  next = dropBlock(next, THEME_START, THEME_END);
  next = dropBlock(next, SIDEBAR_START, SIDEBAR_END);
  next = restoreThemeOrigin(next);
  writeAtomic(report.file, next, identity.TMP_SUFFIX);
  return { ok: true, message: 'herdr: managed blocks removed, [theme] restored' };
}

module.exports = {
  inspect,
  apply,
  remove,
  setSidebarRows,
  applyAppearance,
  chromeVariant,
  blockVariant,
  THEME_START,
  SIDEBAR_START,
};
