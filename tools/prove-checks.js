#!/usr/bin/env node
// Prove that tools/check.js can fail.
//
// A check that can only pass is not a check, and this repository has had one:
// a codepoint-range invariant that carried a literal backspace where `\b` was
// meant, matched nothing, and printed as if it were fine. Each case below puts
// a known-bad shape back into a source file, runs the invariants, and restores
// the file; the run fails if a shape that must be caught is not, or if one
// that must be tolerated is flagged. The shapes are the regressions that were
// actually shipped or actually proposed, not hypotheticals.
//
// Files are restored byte-for-byte in a finally block, so a failing case does
// not leave the tree dirty. An interrupted run might; `git status` shows it.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const EN_DASH = '–';

function runCheck() {
  const out = spawnSync(process.execPath, [path.join(root, 'tools', 'check.js')], {
    cwd: root,
    encoding: 'utf8',
  });
  return { code: out.status, text: `${out.stdout}${out.stderr}`.trim() };
}

// Anchors are exact source lines. If one goes missing the case throws rather
// than silently passing — a prover with a stale anchor proves nothing.
const GHOSTTY = 'lines: RANGES.map(([a, b]) => `font-codepoint-map = U+${a}-U+${b}=${FONT_FAMILY}`),';
const KITTY = 'lines: RANGES.map(([a, b]) => `symbol_map U+${a}-U+${b} ${FONT_FAMILY}`),';

const cases = [
  // lib/font.js — the terminal blocks. #4 and #8 were both shipped for months.
  [
    'lib/font.js',
    GHOSTTY,
    GHOSTTY.replace('=${FONT_FAMILY}`', '="${FONT_FAMILY}"`'),
    'ghostty: quoted family (#8, shipped v1.0.0–v1.3.7)',
  ],
  ['lib/font.js', GHOSTTY, GHOSTTY.replace('=${FONT_FAMILY}`', "='${FONT_FAMILY}'`"), 'ghostty: single-quoted family'],
  [
    'lib/font.js',
    GHOSTTY,
    GHOSTTY.replace('=${FONT_FAMILY}`', '=" ${FONT_FAMILY} "`'),
    'ghostty: quotes with padding inside',
  ],
  ['lib/font.js', KITTY, KITTY.replace('} ${FONT_FAMILY}`', '} "${FONT_FAMILY}"`'), 'kitty: quoted family'],
  [
    'lib/font.js',
    GHOSTTY,
    GHOSTTY.replace('lines: RANGES.map(', 'lines: [`font-family = ${FONT_FAMILY}`, ...RANGES.map(').replace(
      '),',
      ')],',
    ),
    'ghostty: claims the primary font (#4, shipped v1.0.0–v1.3.3)',
  ],
  [
    'lib/font.js',
    GHOSTTY,
    GHOSTTY.replace('=${FONT_FAMILY}`', '="${FONT_FAMILY}`'),
    'ghostty: one unbalanced quote — known gap, asserted',
    false,
  ],

  // READMEs — the hand-mapping ranges. All three drifted after the 24th vendor.
  [
    'README.md',
    `U+E1A0${EN_DASH}U+E1B7`,
    `U+E1A0${EN_DASH}U+E1B3`,
    'README: stale end of range (shipped v1.3.6–v1.3.7)',
  ],
  ['README.zh-CN.md', `U+E1C0${EN_DASH}U+E1C5`, `U+E1C0${EN_DASH}U+E1D1`, 'README zh: second range drifted (shipped)'],
  ['README.ja.md', `U+E1C0${EN_DASH}U+E1C5`, '', 'README ja: a range dropped from the prose'],
  [
    'README.md',
    `U+E1A0${EN_DASH}U+E1B7`,
    `U+E1A0${EN_DASH}U+E1B70`,
    'README: fifth hex digit read as a stray character',
  ],
  [
    'README.md',
    `U+E1A0${EN_DASH}U+E1B7`,
    `U+E1A0${EN_DASH}U+E1B7 (was U+e1a0-U+e1b3)`,
    'README: lower-case copy of the stale range alongside',
  ],
  [
    'README.ja.md',
    `U+E1A0${EN_DASH}U+E1B7`,
    'U+E1A0-U+E1B7',
    'README ja: hyphen instead of en dash is the same range',
    false,
  ],
  [
    'README.ja.md',
    `U+E1A0${EN_DASH}U+E1B7`,
    `U+e1a0${EN_DASH}U+e1b7`,
    'README ja: lower-case hex is the same range',
    false,
  ],

  // tools/codepoints.toml — a glyph outside every mapped range (E1B7 once was).
  ['tools/codepoints.toml', 'glm = "E1B7"', 'glm = "E1BF"', 'codepoints: glyph past the end of the mapped range'],

  // lib/state.js — the Spaces column has to reach every display, on a real token.
  [
    'lib/state.js',
    "const SPACE_PRIORITY = ['blocked', 'working', 'done', 'idle_fresh', 'idle', 'idle_stale', 'unknown'];",
    "const SPACE_PRIORITY = ['blocked', 'working', 'done', 'idle', 'unknown'];",
    'spaces: priority list misses the two idle tiers (#11, shipped v1.3.5–v1.3.8)',
  ],
  [
    'lib/state.js',
    "return `space_${display.startsWith('idle') ? 'idle' : display}`;",
    'return `space_${display}`;',
    'spaces: idle tier not collapsed, so the token clears every state mark',
  ],
  // Adding rather than removing: a removed token trips the mapping check above
  // before this one, so the only way to reach it is a token nothing draws.
  [
    'lib/state.js',
    "  'space_label',\n];",
    "  'space_label',\n  'space_never_drawn',\n];",
    'spaces: a published token with no cell in the sidebar block',
  ],
  // Renaming a cell to something the published name is a prefix of. A bare
  // substring test passes this — review caught that, so it is asserted here.
  [
    'lib/managed-config.js',
    "cell('$space_idle', state.idle),",
    "cell('$space_idle_fresh', state.idle),",
    'spaces: cell renamed to a longer name containing the published one',
  ],
  // Dropping the builtin cells hides every remote machine's workspaces — the
  // plugin's `$`-tokens stay empty for anything its daemon cannot see.
  [
    'lib/managed-config.js',
    "    '\"state_icon\"',\n    cell('workspace', state.none),",
    '',
    'spaces: Spaces rows without the builtin cells hide remote machines',
  ],

  // The same hole in the Agents panel: a remote machine's agent carries no
  // plugin tokens, so its row renders empty without the builtin.
  [
    'lib/managed-config.js',
    "        cell('machine', state.subtle, true),",
    '',
    'agents: agent rows without the builtin machine cell hide remote agents',
  ],

  // THIRD_PARTY_NOTICES.md — the roster has to name every vendor. All three
  // shapes below were real: three marks went uncredited for five releases, and
  // the glyph count sat four vendors out of date.
  [
    'THIRD_PARTY_NOTICES.md',
    '| devin | Cognition Devin (proprietary) |\n',
    '',
    'vendors: a mark drawn but never credited (shipped v1.3.5–v1.3.10)',
  ],
  [
    'THIRD_PARTY_NOTICES.md',
    '30 icon glyphs',
    '29 icon glyphs',
    'vendors: the notices state a stale glyph count (shipped)',
  ],
  // The same staleness in prose, once per language — each spells its number
  // its own way, so each needs its own case.
  [
    'README.md',
    'Twenty-four vendors have a mark',
    'Twenty-three vendors have a mark',
    'vendors: English README undercounts the roster (shipped v1.3.6–v1.3.10)',
  ],
  [
    'README.zh-CN.md',
    '\u4e8c\u5341\u56db\u5bb6\u6709\u81ea\u5df1\u7684\u6807\u8bb0',
    '\u4e8c\u5341\u4e09\u5bb6\u6709\u81ea\u5df1\u7684\u6807\u8bb0',
    'vendors: Chinese README undercounts the roster (shipped)',
  ],
  [
    'README.ja.md',
    '24 \u306e\u30d9\u30f3\u30c0\u30fc\u304c\u72ec\u81ea\u306e\u30de\u30fc\u30af',
    '23 \u306e\u30d9\u30f3\u30c0\u30fc\u304c\u72ec\u81ea\u306e\u30de\u30fc\u30af',
    'vendors: Japanese README undercounts the roster (shipped)',
  ],
  ['lib/logos.js', "  glm: 'GLM',", '', 'vendors: a vendor dropped from one of the three tables in logos.js'],

  // lib/state.js — a vendor we can name must never end up nameless (#10).
  [
    'lib/state.js',
    'if (!clean || locationOnly(clean, cwd)) return nameFor(agent) ?? clean;',
    'if (locationOnly(clean, cwd)) return nameFor(agent) ?? clean;',
    'title: no fallback for an empty title (#10, shipped v1.0.0–v1.3.9)',
  ],
  [
    'lib/state.js',
    "  const clean = typeof title === 'string' ? title.trim() : '';",
    "  const clean = typeof title === 'string' ? title : '';",
    'title: whitespace-only title not seen as empty',
  ],
  // The other direction: a title that says something must keep saying it.
  [
    'lib/state.js',
    'if (!clean || locationOnly(clean, cwd)) return nameFor(agent) ?? clean;\n  return clean;',
    'return nameFor(agent) ?? clean;',
    'title: vendor name always wins, so real titles are lost',
  ],

  // lib/state.js — a failed label read must not erase the labels. The guard is
  // one condition; this is what removing it costs.
  [
    'lib/state.js',
    'if (tabs.size > 0 && workspaces.size > 0) {',
    'if (tabs.size > 0) {',
    'labels: an empty workspace list wipes the cached labels (shipped v1.0.0–v1.3.11)',
  ],
  [
    'lib/state.js',
    '  } else if (cache.tabs.size > 0) {',
    '  } else if (false) {',
    'labels: a failed read does not take the TTL, so every frame asks again',
  ],

  // lib/workspace-order.js — the order must settle or it loops over IPC.
  [
    'lib/workspace-order.js',
    '.sort((a, b) => descending(a.key, b.key) || a.first - b.first);',
    '.sort((a, b) => descending(a.key, b.key) || (Math.random() < 0.5 ? -1 : 1));',
    'workspace order: unstable tiebreak between equal keys',
  ],
  [
    'lib/workspace-order.js',
    'return [...active, ...inactive].flatMap((group) => group.ids);',
    'return [...active, ...inactive.reverse()].flatMap((group) => group.ids);',
    'workspace order: inactive block flipped on every pass',
  ],

  // lib/palette.js — every sidebar ink clears the contrast floor (#5).
  [
    'lib/palette.js',
    "subtle: '#7c7f93'",
    "subtle: '#e0e0e0'",
    'palette: light subtle ink under the contrast floor (#5 was 3.06:1 at best)',
  ],
];

function withEdit(file, from, to, label, expectCaught = true) {
  const target = path.join(root, file);
  const original = fs.readFileSync(target);
  const text = original.toString('utf8');
  if (!text.includes(from)) throw new Error(`${label}: anchor missing in ${file}`);
  if (text.split(from).length !== 2) throw new Error(`${label}: anchor not unique in ${file}`);
  let result;
  try {
    fs.writeFileSync(target, text.replace(from, to), 'utf8');
    result = runCheck();
  } finally {
    fs.writeFileSync(target, original);
  }
  const caught = result.code !== 0;
  const ok = caught === expectCaught;
  const firstLine = result.text.split('\n').find((line) => /: |block:/.test(line)) ?? result.text.split('\n')[0] ?? '';
  console.log(`${ok ? 'ok  ' : 'BAD '} ${caught ? 'caught  ' : 'passed  '} ${label}`);
  if (!ok || caught) console.log(`      ${firstLine.slice(0, 140)}`);
  return ok;
}

const baseline = runCheck();
if (baseline.code !== 0) {
  console.error(`baseline check fails; fix that before proving anything:\n${baseline.text}`);
  process.exit(2);
}

const results = cases.map(([file, from, to, label, expectCaught]) => withEdit(file, from, to, label, expectCaught));
const after = runCheck();
const failed = results.filter((ok) => !ok).length;
console.log(
  `\n${results.length - failed}/${results.length} shapes behaved; tree restored: ${after.code === 0 ? 'yes' : 'NO'}`,
);
process.exitCode = failed === 0 && after.code === 0 ? 0 : 1;
