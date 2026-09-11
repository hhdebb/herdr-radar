'use strict';

// One source of truth for every colour this project puts on screen: the few
// Herdr chrome tokens we override, and the sidebar tokens we publish. Keeping
// them in one file is the point — a theme picked in Herdr and a sidebar
// coloured by hand drift apart, and the seam shows.
//
// Herdr has no theme-file format: a built-in is chosen by name, and
// `[theme.custom]` overrides tokens on top of it (`resolve_palette_for_theme_name`
// does `Palette::from_name(name).with_overrides(custom)`). Third-party themes
// use the same table — the marketplace's herdr-theme-picker writes it too.
//
// Which is exactly why this file overrides as LITTLE as possible. Copying a
// whole built-in palette in here would pin every colour: switching themes in
// Herdr's settings would change nothing, and `auto_switch` could no longer
// repaint for a light or dark host, because `[theme.custom]` is one static
// table applied to whichever theme is live. Override one token and the rest of
// the theme still works.

// The only chrome token we take over, and why:
//
// A built-in's `active_row_bg` is often a grey a shade off `panel_bg`, so the
// current Space and the focused Agent read as unselected (Tokyo Night Day's
// #d2d3da against its #e1e2e7 panel is the case that prompted this). These are
// that theme family's own selection blue, pushed to where it works as a row
// fill.
//
// Two variants because one value cannot serve both: a fill has to sit darker
// than a light panel and lighter than a dark one, and the row's text colour
// does not change with it. `bin/configure.js` picks the variant from the
// configured theme name and leaves the block out entirely under `auto_switch`,
// where neither value would be right half the time.
const chrome = {
  light: { active_row_bg: '#b9cdf2' },
  dark: { active_row_bg: '#414868' },
};

// Light built-ins, for that choice. Everything else in Herdr's THEME_NAMES is
// dark; `terminal` follows the host's own colours and counts as neither.
const lightThemes = [
  'catppuccin-latte',
  'tokyo-night-day',
  'gruvbox-light',
  'one-light',
  'solarized-light',
  'kanagawa-lotus',
  'rose-pine-dawn',
];

// Vendor colours, shown while an agent works. Shape already carries the state
// (§2.1), which frees colour to say whose agent it is. Sidebar token colours
// are static hex and cannot follow the theme (quirks §1), so every value here
// is chosen to read on both light and dark panels.
// Vendor hues. Only Claude's coral and Gemini's blue are the vendor's own;
// the rest of these companies use monochrome marks, so the colour here is
// chosen to be told apart at a glance rather than to be faithful — the eye is
// picking one row out of thirty, not admiring a logo. Green and red are left
// out on purpose: they mean done and blocked, and a vendor wearing either
// would read as a state.
//
// A vendor with no entry falls back to `other`. The roster is short because
// of a hard ceiling: Herdr allows 16 tokens in a sidebar row, and a working
// logo costs one of them per hue — its glyph changes every frame as the ring
// turns, so no value rule can colour it, and the colour has to come from a
// token name. An idle logo is free by comparison (one cell, one rule per hue),
// but a hue that only applied while a session sat still would be the wrong way
// round. So the table stays at what the row can carry in both states.
const brand = {
  claude: '#d97757', // Anthropic coral
  codex: '#4f46e5', // indigo — OpenAI's own marks are monochrome, and a grey
  //                   beside Claude's warm coral reads as "no colour at all".
  //                   Not cyan (the eye files it under the done green), not the
  //                   theme's own accent blue, which the workspace names use
  grok: '#475569', // xAI slate, a shade deeper than the idle grey it sits near
  gemini: '#4285f4', // Google blue
  agy: '#4c8dff', // azure — the third blue in this table, so it earns its place
  //                 by lightness: brighter than Codex's indigo and less
  //                 saturated than Gemini's blue, which is the pair it has to
  //                 be told apart from in a column
  kiro: '#ffffff', // see brandByVariant: white on a dark panel, ink on a light
  other: '#c78a1f', // any other recognised harness
};

// The vendors with a colour of their own, in table order. The Agents row
// colours a logo by rule and the Spaces row gives each of these a token, so
// both lists have to name the same vendors or a mark is coloured in one panel
// and grey in the other — which is how Antigravity and Kiro ended up branded
// beside their titles and anonymous in Spaces.
const brandVendors = Object.keys(brand).filter((vendor) => vendor !== 'other');

// The one vendor colour that cannot be static.
//
// Every other hex above was picked to read on a light panel and a dark one,
// which is what keeps this table simple. White cannot be: it is the panel on
// one side and the text on the other. Kiro's mark is monochrome, so white is
// the faithful choice on a dark sidebar and the only thing that is wrong on a
// light one — the same split the freshness scale already makes below, handled
// the same way. The sidebar block is rebuilt per appearance (managed-config's
// sidebarBlock), so nothing new has to run for this to follow a desktop flip.
const brandByVariant = {
  light: { kiro: '#26272e' },
  dark: { kiro: '#ffffff' },
};

// The vendor colours for one appearance, to `stateFor`'s pattern.
function brandFor(variant) {
  return { ...brand, ...(brandByVariant[variant] ?? brandByVariant.light) };
}

// State colours. Green and red are semantic and outrank branding: they exist
// to pull the eye. Idle recedes so a glance separates busy from parked.
const state = {
  done: '#4c9a5a',
  blocked: '#c04a4a',
  idle: '#6e738d',
  unknown: '#907aa9',
  none: '#9a9eb3', // a Space with no live agent: a dot, so names stay aligned
  subtle: '#7c7f93', // titles and other second-rank text
};

// The freshness scale, and colour is its entire signal — the three tiers draw
// the same mark (lib/logos.js).
//
// The middle tier is plain text on purpose. It was amber for a while, chosen
// to make the scale read as a cooling gradient (warm, cooling, cold), and the
// metaphor was fine but the arithmetic was not: most sessions are in the
// middle most of the time, so the amber was not a signal, it was the
// background — a high-attention colour applied to "nothing in particular",
// competing with the green it was supposed to defer to. A scale over a list
// only needs to mark the DEVIATIONS: worked in the last hours stands out,
// untouched since yesterday recedes, and everything between is what ordinary
// looks like.
//
// It flips with the panel, because receding means light-on-light but
// dark-on-dark — a single static hex cannot fade on both (quirks §1). The
// faded end must also actually fade: its first value was a light *blue*
// (#b3b6c4), which over a warm translucent panel read as tinted text, a
// highlight rather than an absence. Stale keeps almost no chroma.
//
// `idleNormal` is deliberately separate from `state.idle`: the Spaces list
// paints its own idle mark with the latter, and "this workspace has nothing
// running" is not a point on the freshness scale.
//
// An entry is one row now — `logo · title` — so these three ARE the entry's
// text colour, not a decoration beside it. That raises the bar: a tier has to
// stay readable as a whole sentence, not just legible as a mark.
const stateByVariant = {
  light: {
    idleFresh: '#416c4f',
    idleNormal: '#6b6259',
    idleStale: '#a4a5a9',
  },
  dark: {
    idleFresh: '#95bba2',
    idleNormal: '#a99e92',
    idleStale: '#585a64',
  },
};

// The state colours for one appearance. Everything outside the freshness
// scale reads acceptably on either side and stays shared.
function stateFor(variant) {
  return { ...state, ...(stateByVariant[variant] ?? stateByVariant.light) };
}

module.exports = { chrome, lightThemes, brand, brandVendors, brandFor, state, stateFor };
