#!/usr/bin/env node
'use strict';

// `npm run check`: the declaration files agree with lib/identity.js, and every
// script parses. No test runner needed for a zero-dependency plugin.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const problems = require('../lib/identity').verify(root);
for (const dir of ['bin', 'lib']) {
  for (const file of fs.readdirSync(path.join(root, dir))) {
    if (!file.endsWith('.js')) continue;
    try {
      execFileSync(process.execPath, ['--check', path.join(root, dir, file)], { stdio: 'pipe' });
    } catch (error) {
      problems.push(`${dir}/${file}: ${String(error.stderr).trim().split('\n')[0]}`);
    }
  }
}
// The tab-bar block's poll interval has to stay above its timeout. Inverted, a
// slow tick is still running when the next one starts, and on Windows every tick
// is a fresh `cmd.exe`: the overlap compounds until the machine stops
// responding. That happened. It is two numbers on one generated line — exactly
// the pair that drifts — so read them back out of the text that gets written.
const tabBar = require('../lib/managed-config').block();
const timings = /interval_seconds = (\d+), timeout_seconds = (\d+)/.exec(tabBar);
if (!timings) {
  problems.push('tab-bar block: no longer states an interval and a timeout');
} else if (Number(timings[1]) <= Number(timings[2])) {
  problems.push(
    `tab-bar block: interval_seconds (${timings[1]}) must be greater than timeout_seconds ` +
      `(${timings[2]}); overlapping ticks pile up processes`,
  );
}

// Nothing we write into a terminal's config may set that terminal's primary
// font. Our font holds icons and nothing else, so claiming the primary slot
// sends every ordinary character to a font that cannot draw it and the terminal
// falls back to something the user never picked. Ghostty's `font-family` and
// kitty's `font_family` both do exactly that; only the per-codepoint
// redirections belong in the block. Reported in #4.
const claimsPrimaryFont = /^\s*(font-family|font_family)[\s=]/;
for (const terminal of require('../lib/font').TERMINALS) {
  const line = terminal.lines.find((text) => claimsPrimaryFont.test(text));
  if (line) {
    problems.push(
      `${terminal.name} block: sets the terminal's primary font (${line.trim()}); ` +
        'map our codepoints instead, our font has only icons',
    );
  }
}

// Nor may it quote the family name: terminals read the name literally, so the quotes become part of it,
// nothing matches, and the codepoints fall through to whatever else claims the range (in the PUA, a CJK font).
const family = require('../lib/font').FONT_FAMILY;
// Whitespace inside the quotes is still a quoted name, just a worse one.
const quotesFamily = new RegExp(`["']\\s*${family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*["']`);
for (const terminal of require('../lib/font').TERMINALS) {
  const line = terminal.lines.find((text) => quotesFamily.test(text));
  if (line) {
    problems.push(
      `${terminal.name} block: quotes the font family (${line.trim()}); ` +
        'the quotes become part of the name the terminal looks for',
    );
  }
}

// Every colour the sidebar writes has to stay readable on the panel behind it.
//
// Herdr's themes all set `sidebar_bg: Color::Reset`, so the panel is whatever
// the host terminal paints and no value here can know it. The reference panels
// below stand in for it: two real ones this was measured against. They are a
// backstop, not a target — the shipped values clear the floor with room to
// spare, and the point is that a future edit cannot quietly drop below it.
//
// This exists because a value did. `idleStale` was #585a64, which is 2.6:1 on
// a dark panel and capped at 3.06:1 against any background at all, and every
// cell wearing it also asked for the terminal's `dim` — a switch, not a value,
// answered with a third of the way to the background by one terminal and half
// by another. It rendered at 1.8:1 and 1.5:1: present, drawn, unreadable.
// Nothing checked. Reported in #5.
const PANELS = { light: '#eff1f5', dark: '#191724' };
// WCAG's large/bold threshold. Sidebar labels are short and mostly bold; the
// floor is here to catch inks that cannot be read at all, not to force body
// text ratios onto a tier whose job is to recede.
const CONTRAST_FLOOR = 3;

const channel = (v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// Marks, not prose. A vendor's logo is a shape first: coral at 2.8:1 still
// reads as that glyph in that colour, and the Spaces list's "no agent" dot is
// a dot. The floor is about text that cannot be read, so it is scored against
// the inks that carry text and not against these. (Several of the brand values
// are below 3:1 on a light panel, which the palette's own comment claims they
// clear — true of the table as a whole against a darker light panel than the
// reference here, and worth its own look, but not this check's business.)
const palette = require('../lib/palette');
const markColours = new Set([...Object.values(palette.brand), palette.state.none]);

const managed = require('../lib/managed-config');
for (const [variant, panel] of Object.entries(PANELS)) {
  const text = managed.sidebarBlock(variant);
  // `dim` asks the terminal to fade an ink by an amount it chooses and we
  // cannot measure. Whatever fade a cell needs belongs in its colour.
  if (/dim = true/.test(text)) {
    problems.push(`sidebar block (${variant}): asks for the terminal's dim; put the fade in the colour`);
  }
  for (const colour of new Set(text.match(/#[0-9a-f]{6}/g) ?? [])) {
    if (markColours.has(colour)) continue;
    const ratio = contrast(colour, panel);
    if (ratio < CONTRAST_FLOOR) {
      problems.push(
        `sidebar block (${variant}): ${colour} is ${ratio.toFixed(2)}:1 on ${panel}, ` +
          `under the ${CONTRAST_FLOOR}:1 floor`,
      );
    }
  }
}

// Every glyph the font defines has to fall inside a range the installer maps.
//
// The terminal only looks in our font for the codepoints we tell it about, so a
// glyph outside those ranges is drawn from whatever the terminal had — which is
// nothing, silently, while install-font reports success. Adding the 24th vendor
// at E1B7 did exactly that: one past the end of a range written down by hand.
// Read the codepoints back out of the source of truth rather than trusting two
// places to agree.
const codepointsToml = fs.readFileSync(path.join(root, 'tools', 'codepoints.toml'), 'utf8');
const glyphSection = codepointsToml.split(/^\[fit\]/m)[0];
const declared = [...glyphSection.matchAll(/^([a-z_][a-z0-9_]*)\s*=\s*"([0-9A-Fa-f]{4})"/gm)].map(([, name, hex]) => ({
  name,
  point: parseInt(hex, 16),
}));
if (declared.length === 0) {
  problems.push('codepoints.toml: no glyph assignments found — did the file move?');
}
const { RANGES } = require('../lib/font');
const mapped = RANGES.map(([lo, hi]) => [parseInt(lo, 16), parseInt(hi, 16)]);
for (const { name, point } of declared) {
  if (!mapped.some(([lo, hi]) => point >= lo && point <= hi)) {
    problems.push(
      `codepoints.toml: ${name} at U+${point.toString(16).toUpperCase()} is outside every ` +
        'range install-font maps, so the terminal will never look for it',
    );
  }
}

// Adding a vendor means touching six places, and missing one is silent.
//
// A vendor needs a codepoint, a glyph, a mark to build it from, a PUA entry, a
// text fallback, a display name, and a line in the third-party notices. Nothing
// held those together, and three of them drifted: `amp`, `devin` and `qodercli`
// went five releases with their marks drawn and their sources uncredited, which
// is the one kind of drift here that is not merely cosmetic. The display name
// for `omp` said OhMyPosh — a prompt theme engine — while the notices had
// credited oh-my-pi correctly all along (#12).
//
// The notices are the only place a human must write prose, so this cannot check
// that the words are right; it checks that no vendor is missing from any of the
// lists, which is what went wrong each time.
const logos = require('../lib/logos');
const notices = fs.readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
const vendorKeys = {
  'logos.js PUA': Object.keys(logos.PUA),
  'logos.js TEXT': Object.keys(logos.TEXT),
  'logos.js DISPLAY': Object.keys(logos.DISPLAY),
  // `declared` is already every key assigned a codepoint, which leaves out the
  // file's `family` and `version` lines. The state glyphs share the file but
  // are not vendors.
  'codepoints.toml': declared.map(({ name }) => name).filter((name) => !name.startsWith('state_')),
  'assets/marks': fs
    .readdirSync(path.join(root, 'assets', 'marks'))
    .filter((f) => f.endsWith('.svg'))
    .map((f) => f.slice(0, -'.svg'.length)),
  // Padding around the cell is legal Markdown and would otherwise read as a
  // missing vendor — a false alarm on a row that is perfectly correct.
  'THIRD_PARTY_NOTICES.md': [...notices.matchAll(/^\|\s*([a-z][a-z0-9_]*)\s*\|/gm)].map(([, key]) => key),
};
const everyVendor = new Set(Object.values(vendorKeys).flat());
for (const [where, keys] of Object.entries(vendorKeys)) {
  const held = new Set(keys);
  for (const vendor of everyVendor) {
    if (!held.has(vendor)) problems.push(`${where}: no entry for '${vendor}', which every other list has`);
  }
}
// tools/svg/ is allowed the state glyphs on top of the vendors, so it is
// checked one way only: a mark with nothing pointing at it is dead weight, but
// a vendor with no mark cannot be built at all.
const sources = fs
  .readdirSync(path.join(root, 'tools', 'svg'))
  .filter((f) => f.endsWith('.svg'))
  .map((f) => f.slice(0, -'.svg'.length));
for (const vendor of everyVendor) {
  if (!sources.includes(vendor)) problems.push(`tools/svg: no ${vendor}.svg to build that vendor's glyph from`);
}
// Counts written out in prose go stale the moment a vendor is added, and three
// of them had: the notices claimed 29 glyphs against 30, and all three READMEs
// still said twenty-three vendors after the 24th landed. Each is spelled for
// its own language, so the pattern is per file rather than one shared regex.
const vendorCount = Object.keys(logos.PUA).length;
const counted = [
  ['THIRD_PARTY_NOTICES.md', notices, /(\d+) icon glyphs/, declared.length, 'glyphs the font is built from'],
  ['README.md', null, /(Twenty-\w+) vendors have a mark/, vendorCount, 'vendors with a mark'],
  [
    'README.zh-CN.md',
    null,
    /([\u4e00-\u9fff]+)\u5bb6\u6709\u81ea\u5df1\u7684\u6807\u8bb0/,
    vendorCount,
    'vendors with a mark',
  ],
  [
    'README.ja.md',
    null,
    /(\d+) \u306e\u30d9\u30f3\u30c0\u30fc\u304c\u72ec\u81ea\u306e\u30de\u30fc\u30af/,
    vendorCount,
    'vendors with a mark',
  ],
];
// Spelled-out numerals, only as far as this project can plausibly grow.
const WORDS = ['Twenty-one', 'Twenty-two', 'Twenty-three', 'Twenty-four', 'Twenty-five', 'Twenty-six'];
const CJK = [
  '\u4e8c\u5341\u4e00',
  '\u4e8c\u5341\u4e8c',
  '\u4e8c\u5341\u4e09',
  '\u4e8c\u5341\u56db',
  '\u4e8c\u5341\u4e94',
  '\u4e8c\u5341\u516d',
];
const asNumber = (text) => {
  if (/^\d+$/.test(text)) return Number(text);
  const word = WORDS.indexOf(text);
  if (word !== -1) return 21 + word;
  const cjk = CJK.indexOf(text);
  return cjk === -1 ? NaN : 21 + cjk;
};
for (const [file, preloaded, pattern, want, what] of counted) {
  const text = preloaded ?? fs.readFileSync(path.join(root, file), 'utf8');
  const found = pattern.exec(text);
  if (!found) {
    problems.push(`${file}: no longer states how many ${what} there are, or says it differently`);
  } else if (asNumber(found[1]) !== want) {
    problems.push(`${file}: says ${found[1]} where there are ${want} ${what}`);
  }
}

// Every display a pane can carry has to reach the Spaces column, and has to
// land on a token that exists.
//
// Two lists and a mapping have to agree: STATES is what a pane's display can
// be, SPACE_PRIORITY is which of them a workspace's single mark speaks for, and
// spaceToken() names the cell it publishes under. When idle was split into
// three tiers only the first list was updated, so a workspace of fresh or stale
// agents matched nothing and drew the no-agent dot (#11). The second failure is
// quieter still: writeSpaceState nulls every token it does not match, so a name
// outside SPACE_TOKENS does not mis-draw one cell, it clears every state mark on
// the row at once. (The logos and the label survive it — they are written after,
// from a separate object — so the row goes nameless rather than vanishing.)
const state = require('../lib/state');
const spaceTokens = new Set(state.SPACE_TOKENS);
for (const display of state.STATES) {
  if (!state.SPACE_PRIORITY.includes(display)) {
    problems.push(`SPACE_PRIORITY: no entry for '${display}', so a workspace holding only those agents reads as empty`);
  }
  // Vendor only matters for `working`; an unbranded one must still land.
  for (const vendor of [...palette.brandVendors, 'nosuchvendor']) {
    const token = state.spaceToken(display, vendor);
    if (!spaceTokens.has(token)) {
      problems.push(
        `spaceToken('${display}', '${vendor}') is '${token}', which is not in SPACE_TOKENS — ` +
          'it clears every state mark on the row',
      );
    }
  }
}
for (const display of state.SPACE_PRIORITY) {
  if (!state.STATES.includes(display)) {
    problems.push(`SPACE_PRIORITY: '${display}' is not a display any pane can carry`);
  }
}
// A token with no cell in the sidebar block is a mark that never draws.
//
// Matched with the closing quote the generated cell carries, not as a bare
// substring: `$space_idle` occurs inside `$space_idle_fresh`, so a cell renamed
// to something that merely starts with the published name would have satisfied
// a substring test while the name actually published had no cell left.
for (const variant of ['light', 'dark']) {
  const block = managed.sidebarBlock(variant);
  for (const token of state.SPACE_TOKENS) {
    if (token === 'space_label') continue;
    if (!block.includes(`token = "$${token}"`)) {
      problems.push(`sidebar block (${variant}): no cell for $${token}, so that mark never draws`);
    }
  }
  // The builtin cells are what render a connected machine's workspaces; rows
  // without them hide every remote machine from the Spaces column.
  if (!block.includes('"state_icon"') || !block.includes('"workspace"')) {
    problems.push(
      `sidebar block (${variant}): Spaces rows lack the builtin "state_icon" / "workspace" cells — remote machines render empty`,
    );
  }
  // The Agents panel has the same hole: an agent on a connected machine
  // carries none of the plugin's tokens, and its row renders empty without
  // the builtin `machine` cell, which draws only for remote agents.
  if (!block.includes('"machine"')) {
    problems.push(
      `sidebar block (${variant}): agent rows lack the builtin "machine" cell — remote-machine agents render empty`,
    );
  }
}

// A vendor this plugin can name never goes nameless.
//
// The row is `logo · title`. When the title says nothing the vendor's name
// takes its place, and the one case that was missed is the one that happens
// most: a pane with no title at all. `locationOnly()` answers false for an
// empty string — it is asking "is this title only a location", and an absent
// title is not — so the fallback never ran and Antigravity and codex rows drew
// a logo with nothing beside it (#10). The same hole swallowed a title that was
// nothing but the attention bracket, which strips to empty here.
//
// Stated as the property the row actually needs, and run against the real pair
// of functions, since copying the stripping regex into this file would only
// move the drift somewhere else.
const { DISPLAY } = logos;
const CWD = '/home/u/src/notes';
const blank = (value) => typeof value !== 'string' || value.trim() === '';
// Titles that say nothing about which agent this is. The last two arrive
// non-empty and are emptied by the strip, which is why it runs for real.
const SAYS_NOTHING = ['', '   ', '\t\r\n ', CWD, '  ' + CWD + '  ', 'notes', CWD + ': agy', '[!]', '[ · ] '];
// Not reachable from the call site, which only ever passes a string, but the
// function is exported now and a caller that hands it nothing should still get
// a name rather than a crash or a blank.
const NOT_A_STRING = [null, undefined, 0, {}];
for (const [agent, display] of Object.entries(DISPLAY)) {
  if (!display) continue;
  for (const raw of SAYS_NOTHING) {
    const resolved = state.vendorTitle(agent, state.stripVendorPulse(raw), CWD);
    if (resolved !== display) {
      problems.push(
        `vendorTitle(${JSON.stringify(agent)}, ${JSON.stringify(raw)}) is ${JSON.stringify(resolved)}, ` +
          `not ${JSON.stringify(display)} — that row draws a logo with no name beside it`,
      );
    }
  }
  for (const raw of NOT_A_STRING) {
    if (blank(state.vendorTitle(agent, raw, CWD))) {
      problems.push(`vendorTitle(${JSON.stringify(agent)}, ${String(raw)}) is blank; it should still name the vendor`);
    }
  }
}
// And the other half: a title that does say something keeps its words. Without
// this, "always return the vendor name" would satisfy everything above.
for (const [raw, want] of [
  ['Fixing the parser', 'Fixing the parser'],
  ['  Fixing the parser  ', 'Fixing the parser'],
  ['Fixing  the  parser', 'Fixing  the  parser'],
  ['[!] Fixing the parser', 'Fixing the parser'],
  ['notes: a real title', 'notes: a real title'],
]) {
  const resolved = state.vendorTitle('claude', state.stripVendorPulse(raw), CWD);
  if (resolved !== want) {
    problems.push(
      `vendorTitle('claude', ${JSON.stringify(raw)}) is ${JSON.stringify(resolved)}, not ${JSON.stringify(want)}`,
    );
  }
}
// An agent with no name of its own has nothing to fall back to, and an empty
// string is the right answer: stateTokens turns it into a null token, which
// clears the cell, where a blank string would leave one drawn and empty.
if (state.vendorTitle('nosuchvendor', '', CWD) !== '') {
  problems.push('vendorTitle: an unnamed vendor with no title should resolve to the empty string');
}

// The ranges the READMEs print have to be the ranges the installer maps.
//
// A user on a terminal we do not write config for reads them and maps by hand,
// so a stale range there is a silently half-drawn sidebar for exactly the people
// who cannot check it against anything. All three said E1A0-E1B3 long after the
// 24th vendor moved the end to E1B7, and the Chinese one had drifted to E1D1 on
// the second range as well. Derived, because prose does not get recompiled.
const documented = RANGES.map(([lo, hi]) => `U+${lo}\u2013U+${hi}`);
for (const name of ['README.md', 'README.zh-CN.md', 'README.ja.md']) {
  const prose = fs.readFileSync(path.join(root, name), 'utf8');
  // A hyphen is the same range typed on a keyboard without an en dash, and
  // lower-case hex is the same range too. The lookahead stops a fifth digit
  // from being read as a correct four-digit range with a stray character.
  const printed = [...prose.matchAll(/U\+[0-9A-F]{4}[\u2013-]U\+[0-9A-F]{4}(?![0-9A-F])/gi)].map(([text]) =>
    text.toUpperCase().replace('-', '\u2013'),
  );
  for (const range of printed) {
    if (!documented.includes(range)) {
      problems.push(
        `${name}: documents ${range}, which install-font does not map (it maps ${documented.join(' and ')})`,
      );
    }
  }
  for (const range of documented) {
    if (!printed.includes(range)) {
      problems.push(`${name}: never tells a user to map ${range}`);
    }
  }
}

// Reordering workspaces has to settle. The module moves them, Herdr emits
// workspace.reordered, the frame wakes and asks again — so if feeding the
// result back in ever produces a different list, that is not a wrong order,
// it is an infinite write loop over IPC. Idempotence is the whole safety
// argument for the feature, so it is checked rather than assumed.
//
// Randomised because the interesting cases are interactions: families whose
// members start apart, a parent with no key of its own, ties, and parent links
// that happen to form a cycle.
const { desiredOrder } = require('../lib/workspace-order');
const ids = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'];
let unstable = null;
for (let i = 0; i < 200 && !unstable; i += 1) {
  const order = [...ids].sort(() => Math.random() - 0.5);
  const keys = new Map();
  const parents = new Map();
  for (const id of ids) {
    if (Math.random() < 0.7) keys.set(id, String(Math.floor(Math.random() * 4)).padStart(3, '0'));
    if (Math.random() < 0.25) {
      const parent = ids[Math.floor(Math.random() * ids.length)];
      if (parent !== id) parents.set(id, parent);
    }
  }
  try {
    const once = desiredOrder(order, keys, parents);
    const twice = desiredOrder(once, keys, parents);
    if (once.join() !== twice.join()) {
      unstable = `once=${once.join(',')} twice=${twice.join(',')}`;
    } else if ([...once].sort().join() !== [...order].sort().join()) {
      unstable = `membership changed: in=${order.join(',')} out=${once.join(',')}`;
    }
  } catch (error) {
    unstable = `threw: ${error.message}`;
  }
  if (unstable) {
    unstable += `\n  order=${order.join(',')} keys=${JSON.stringify([...keys])} parents=${JSON.stringify([...parents])}`;
  }
}
if (unstable) {
  problems.push(`workspace order: desiredOrder is not idempotent — ${unstable}`);
}

// A failed label read must not erase the labels.
//
// `workspacesAsync` answers `[]` both for a timed-out call and for a session
// with nothing open, so `labels()` cannot tell them apart and has to treat an
// empty list as the failure it almost always is — the pane asking is itself in
// a workspace. Committing it would blank every group header to a bare id, and
// the next good read would redraw every one of them; with the header
// fingerprint now sensitive to labels, a flapping socket rewrites the whole
// panel on each swing.
//
// Run rather than read. The guard is one condition, which is exactly the shape
// someone tidies away, so the real module is driven with its two reads
// replaced — the only way to reach the failure branch at all. Everything else
// in this file is synchronous; this is why the verdict is awaited.
async function labelsSurviveAFailedRead() {
  const herdr = require('../lib/herdr');
  const realWorkspaces = herdr.workspacesAsync;
  const realTabs = herdr.tabsAsync;
  // Comfortably past any label TTL, so each call re-reads rather than
  // short-circuiting on the cache.
  const LATER = 60000;
  try {
    herdr.tabsAsync = async () => [{ tab_id: 't1', label: '1' }];
    herdr.workspacesAsync = async () => [{ workspace_id: 'w1', label: 'radar' }];
    const first = await state.labels(0);
    if (first.workspaces.get('w1') !== 'radar') {
      problems.push(
        `labels: a good read should have labelled w1 'radar', got ${JSON.stringify(first.workspaces.get('w1'))}`,
      );
      return;
    }
    // The only way this read can express failure.
    herdr.workspacesAsync = async () => [];
    const after = await state.labels(LATER);
    if (after.workspaces.get('w1') !== 'radar') {
      problems.push(
        'labels: an empty workspace list replaced the cached labels — every group header ' +
          'falls back to its bare id until the next good read',
      );
    }
    // A failure takes the TTL with it, or every frame asks again for as long
    // as the failure lasts.
    let reads = 0;
    herdr.workspacesAsync = async () => {
      reads += 1;
      return [];
    };
    await state.labels(LATER + 1);
    await state.labels(LATER + 2);
    if (reads > 1) {
      problems.push(`labels: ${reads} reads inside one TTL after a failure; a failed read should take the TTL too`);
    }

    // And the cache is not frozen: a good read afterwards still lands.
    herdr.workspacesAsync = async () => [{ workspace_id: 'w1', label: 'renamed' }];
    const recovered = await state.labels(2 * LATER);
    if (recovered.workspaces.get('w1') !== 'renamed') {
      problems.push('labels: a good read after a failed one did not refresh the cache');
    }
  } finally {
    herdr.workspacesAsync = realWorkspaces;
    herdr.tabsAsync = realTabs;
  }
}

labelsSurviveAFailedRead()
  .catch((error) => problems.push(`labels: the check itself threw — ${error.message}`))
  .then(() => {
    if (problems.length) {
      console.error(problems.join('\n'));
      process.exit(1);
    }
    console.log('ok');
  });
