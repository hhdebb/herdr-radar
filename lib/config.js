'use strict';

// The plugin's own config file, and the glyph/behaviour choices read out of it.
//
// Herdr hands plugin commands HERDR_PLUGIN_CONFIG_DIR; config.toml inside it is
// optional and every key has a default, so a missing or malformed file degrades
// to upstream behaviour rather than failing.

const fs = require('node:fs');
const path = require('node:path');

const paths = require('./paths');

// A subset TOML reader: scalars and one level of `[table]`. The file this parses
// is a handful of keys the user writes by hand, so a dependency-free reader is
// worth more than full spec coverage — and Node ships no TOML parser.

// Everything before the first `#` that is not inside a quoted string. A
// quoted value may contain `#` — every hex colour does.
function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#') {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseToml(text) {
  const root = {};
  let table = root;
  for (const raw of text.split('\n')) {
    const line = stripComment(raw).trim();
    if (!line) continue;

    if (line.startsWith('[') && line.endsWith(']')) {
      const name = line.slice(1, -1).trim().replace(/^"|"$/g, '');
      if (typeof root[name] !== 'object' || root[name] === null) root[name] = {};
      table = root[name];
      continue;
    }

    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().replace(/^"|"$/g, '');
    const value = line.slice(eq + 1).trim();
    if (!key || !value) continue;

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      table[key] = value.slice(1, -1);
    } else if (value === 'true' || value === 'false') {
      table[key] = value === 'true';
    } else if (/^-?\d+(\.\d+)?$/.test(value)) {
      table[key] = Number(value);
    } else {
      table[key] = value;
    }
  }
  return root;
}

// Herdr injects HERDR_PLUGIN_CONFIG_DIR into the commands it starts, so an
// action or a startup hook is told where its config lives. Nothing tells a
// process started by hand — `node bin/agent-state.js` from a checkout, which
// is how this plugin is developed and how the README's own recovery step is
// worded — and without a fallback such a daemon quietly ran on defaults:
// every setting the user had chosen, from the glyph variant to the freshness
// thresholds, silently ignored. lib/paths derives the same location the way
// Herdr lays it out.
function load() {
  const dir = process.env.HERDR_PLUGIN_CONFIG_DIR ?? paths.pluginConfigDir(paths.pluginId());
  try {
    return parseToml(fs.readFileSync(path.join(dir, 'config.toml'), 'utf8'));
  } catch {
    return {};
  }
}

const raw = load();
const glyphs = typeof raw.glyphs === 'object' && raw.glyphs !== null ? raw.glyphs : {};

function glyph(state, fallback) {
  const chosen = glyphs[state];
  if (typeof chosen === 'string' && chosen) return chosen;
  // `led_glyph` is upstream's single knob for the blocked/idle mark; honour it
  // so an existing config keeps working.
  if ((state === 'blocked' || state === 'idle') && typeof raw.led_glyph === 'string' && raw.led_glyph) {
    return raw.led_glyph;
  }
  return fallback;
}

// What the user actually wrote for a state, or undefined. `logos.js` needs the
// difference between "chose this mark" and "took the default": the default now
// depends on the variant, an explicit choice never does.
function userGlyph(state) {
  return glyph(state, undefined);
}

// Every state gets its own shape, not just its own colour. Upstream draws
// blocked, idle and unknown with one mark and its suggested row config gives
// idle and unknown the same colour too, so three different situations look
// identical — in a light theme, in a screenshot, or to anyone who does not
// separate those hues easily.
const STATIC_GLYPH = {
  done: glyph('done', '✓'),
  blocked: glyph('blocked', '?'), // it is asking you something
  // The three idle tiers share one mark and differ only in colour; see the
  // note on STATE_PUA in lib/logos.js. Same here, so a font-less terminal
  // shows the same design rather than a second, older one. `working` shares
  // it too — its motion lives on the logo now, not on a spinner here.
  working: glyph('working', '○'),
  idle: glyph('idle', '·'), // parked, nothing wrong
  unknown: glyph('unknown', '◌'), // could not tell
  idle_fresh: glyph('idle_fresh', '·'), // worked recently
  idle_stale: glyph('idle_stale', '·'), // untouched for hours
};

// Spinner frames for `working`: six-dot braille, the gap walking round the
// cell. The eight-dot patterns this cycled before (U+28C0 and up) carry two
// more dots below the six, which reads as a heavier and taller mark beside
// text — and those two barely move, so most of the ink sat still while the
// animation happened above it.
const FRAMES = ['⠋', '⠙', '⠸', '⠴', '⠦', '⠇'];

const holdSetting = raw.done_hold ?? 'until_seen';
const colors = typeof raw.colors === 'object' && raw.colors !== null ? raw.colors : {};

module.exports = {
  raw,
  parseToml,
  STATIC_GLYPH,
  userGlyph,
  FRAMES,

  // Whether the plugin polls the desktop's light/dark appearance and drives
  // Herdr's `[theme] name` from it. Off, Herdr's own `[theme]` settings decide
  // and the plugin's colours follow whichever theme name is configured.
  followAppearance: raw.follow_appearance !== false,

  // `[colors]` overrides for the one Herdr chrome token the theme block sets.
  // A string (hex, named, rgb(...)) replaces the default for that appearance;
  // an empty string means "do not override — let the theme's own value show".
  // Absent means the default.
  activeRowBg: {
    light: typeof colors.active_row_bg_light === 'string' ? colors.active_row_bg_light : undefined,
    dark: typeof colors.active_row_bg_dark === 'string' ? colors.active_row_bg_dark : undefined,
  },

  // auto | font | text | none
  variant: typeof raw.variant === 'string' ? raw.variant : 'auto',

  // How long the green check survives after a turn ends. Herdr collapses `done`
  // into `idle` almost immediately, so the badge is this plugin's own
  // invention; six seconds is easy to miss when several agents finish while you
  // are looking elsewhere.
  doneHoldUntilSeen: holdSetting === 'until_seen',
  doneHoldSeconds: typeof holdSetting === 'number' ? holdSetting : 6,

  // How long an idle/done report has to persist before it counts as a turn
  // end. Herdr's detection can flap to idle for a beat mid-turn (macOS); the
  // grace absorbs it. Zero disables.
  idleGraceMs:
    (typeof raw.idle_grace_seconds === 'number' ? raw.idle_grace_seconds : 2.5) * 1000,

  // Whether a question mark survives until the agent goes back to work.
  // Herdr recognises `blocked` from the shape of the question on screen, so
  // focusing the pane can redraw it out of recognition — the question is still
  // waiting, but the mark is gone. Seeing a question is not answering it:
  // glancing at a pane and coming back to it later is the normal case.
  blockedHoldUntilAnswered: raw.blocked_hold !== false,

  // How long an idle pane keeps reading as recently active, and when it starts
  // reading as abandoned. Herdr has no notion of either — `idle` is `idle`
  // whether the agent stopped a minute ago or on Tuesday — so these two
  // thresholds are what turn one state into three.
  activityFreshMs: (typeof raw.activity_fresh_minutes === 'number' ? raw.activity_fresh_minutes : 15) * 60000,
  activityStaleMs: (typeof raw.activity_stale_minutes === 'number' ? raw.activity_stale_minutes : 120) * 60000,

  showTab: raw.show_tab === true,
  trimGroupPrefix: raw.trim_group_prefix !== false,
  groupGap: raw.group_gap !== false,
  groupIndentWidth: typeof raw.group_indent === 'number' ? raw.group_indent : 2,

  // The mark on a worktree's group header, between the branch corner and the
  // branch name. Deliberately NOT one of our own PUA glyphs: a Nerd Font as
  // the terminal's PRIMARY family already carries the git marks, and primary
  // beats fallback. Owning it would mean a font rebuild, a reinstall on every
  // machine and a wider `font-codepoint-map` range — for a decorative glyph.
  //
  // U+F418 is Octicons' git-branch, chosen over the Powerline symbol (U+E0A0),
  // Devicons' git-branch (U+E725) and Font Awesome's code-fork (U+F126) after
  // looking at all four on a real sidebar; every one of them rendered, so this
  // was taste, not coverage. Written as an escape on purpose — a PUA character
  // pasted in literally is invisible in the source and in every diff of it.
  // The bet is on the primary font being a Nerd Font; where it is not, set
  // `worktree_mark` to another codepoint (or "" to drop the mark) — no code
  // change needed.
  worktreeMark: typeof raw.worktree_mark === 'string' ? raw.worktree_mark : '\uf418',

  // Path of an optional module that may rewrite what is displayed before it
  // is published (lib/hook.js). Absent by default; the plugin ships none.
  renderHook: typeof raw.render_hook === 'string' && raw.render_hook ? raw.render_hook : null,
};
