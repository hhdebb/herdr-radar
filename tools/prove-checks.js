#!/usr/bin/env node
// Prove that the invariants and the tests can fail.
//
// A check that can only pass is not a check, and this repository has had one:
// a codepoint-range invariant that carried a literal backspace where `\b` was
// meant, matched nothing, and printed as if it were fine. Each case below puts
// a known-bad shape back into a source file, runs whatever is meant to catch
// it, and restores the file; the run fails if a shape that must be caught is
// not, or if one that must be tolerated is flagged. The shapes are the
// regressions that were actually shipped or actually proposed, not
// hypotheticals.
//
// A case is [file, from, to, label, expectCaught = true, via = 'check']. `via`
// is 'check' for tools/check.js, or the one test file that should go red — only
// that file runs, so behaviour cases cost a second, not the whole suite.
//
// Files are restored byte-for-byte in a finally block, so a failing case does
// not leave the tree dirty. An interrupted run might; `git status` shows it.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const EN_DASH = '–';

// A test that hangs instead of failing is caught all the same: the timeout
// kills it, and a killed run has no exit code of zero.
function run(via = 'check') {
  const args = via === 'check' ? [path.join(root, 'tools', 'check.js')] : ['--test', via];
  const out = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 60000 });
  return { code: out.status, text: `${out.stdout}${out.stderr}`.trim() };
}

// Both halves must be green before and after, or nothing proved means much.
function allGreen() {
  const check = run('check');
  const tests = spawnSync(process.execPath, ['--test'], { cwd: root, encoding: 'utf8', timeout: 120000 });
  return { ok: check.code === 0 && tests.status === 0, text: `${check.text}\n${tests.stdout}${tests.stderr}`.trim() };
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
    true,
    'test/labels.test.js',
  ],
  [
    'lib/state.js',
    '  } else if (cache.tabs.size > 0) {',
    '  } else if (false) {',
    'labels: a failed read does not take the TTL, so every frame asks again',
    true,
    'test/labels.test.js',
  ],

  // The daemon's liveness (#18, #19): frames on a monotonic clock, liveness
  // asked of the endpoint, and a stall recognised as one.
  [
    'lib/scheduler.js',
    'clock = () => performance.now(),',
    'clock = () => Date.now(),',
    'daemon: frame floor on the wall clock, so a backward step freezes the panel (#18)',
    true,
    'test/scheduler.test.js',
  ],
  [
    'lib/state.js',
    'if (fireAge !== null && fireAge > STALLED_MS) {',
    'if (fireAge !== null && fireAge < STALLED_MS) {',
    'daemon: timer threshold inverted, so healthy daemons get replaced',
    true,
    'test/daemon-status.test.js',
  ],
  // The case review caught: judging a frame in flight on the timer's thirty
  // seconds kills a daemon that is only waiting on a slow Herdr.
  [
    'lib/state.js',
    'if (runningFor !== null && runningFor > HUNG_FRAME_MS) {',
    'if (runningFor !== null && runningFor > STALLED_MS) {',
    'daemon: a slow frame judged as a dead timer, so a slow Herdr gets a kill loop',
    true,
    'test/daemon-status.test.js',
  ],
  [
    'lib/scheduler.js',
    '    lastFireAt = clock();\n',
    '',
    'daemon: the heartbeat stops counting while a frame runs, so slow frames look stalled',
    true,
    'test/scheduler.test.js',
  ],
  [
    'bin/setup.js',
    'state.daemonStatus().then(',
    'state.animatorRunning; state.daemonStatus().then(',
    'daemon: a caller still asks the pid file (#19)',
  ],

  // lib/control.js — a peer that hangs up without a word must still settle the
  // request. Without it, a launcher that had just ended a stalled daemon exited
  // 0 before starting the replacement.
  [
    'lib/control.js',
    "    stream.on('close', () => finish(null));\n",
    '',
    'control: a clean hang-up leaves the request unsettled (found testing v1.3.13)',
    true,
    'test/control.test.js',
  ],

  // lib/herdr.js — a closed target is done, not failed (#21). Counting it as
  // a failure retried every closed pane and workspace once a minute forever.
  [
    'lib/herdr.js',
    'const landed = (reply) => !reply.error || GONE.has(reply.error.code);',
    'const landed = (reply) => !reply.error;',
    'writes: a closed pane is retried forever (#21, shipped v1.0.0-v1.3.13)',
    true,
    'test/dead-targets.test.js',
  ],

  // lib/frame.js — a closed pane takes its other write backoffs with it.
  [
    'lib/frame.js',
    "for (const kind of ['line', 'logo', 'sort']) this.failedAt.delete(`${kind}:${pane}`);",
    '',
    'writes: a closed pane keeps an earlier backoff alive (#21)',
    true,
    'test/dead-targets.test.js',
  ],

  // lib/toml-blocks.js — a table the user claims with a dotted key or an
  // inline table is as taken as one with a header (#22).
  [
    'lib/toml-blocks.js',
    'if (full === table || full.startsWith(under)) return true;',
    'if (full === table) return true;',
    'config: a dotted key under the parent table slips past (#22, shipped v1.0.0-v1.3.14)',
    true,
    'test/foreign-tables.test.js',
  ],
  [
    'lib/toml-blocks.js',
    'if (key[2] && table.startsWith(`${full}.`)) return true;',
    '',
    'config: an inline table above ours slips past (#22)',
    true,
    'test/foreign-tables.test.js',
  ],

  // lib/managed-config.js — a write Herdr cannot parse is undone; one it
  // merely warns about is not (#22).
  [
    'lib/managed-config.js',
    'if (check.parses) return null;',
    'if (check.ok) return null;',
    'config: a stray key rolls back a working install (#22)',
    true,
    'test/checked-write.test.js',
  ],
  [
    'lib/herdr.js',
    'parses: !/config parse error/.test(output)',
    'parses: result.status === 0',
    'config: the exit code stands in for the parse verdict (#22)',
    true,
    'test/checked-write.test.js',
  ],

  // lib/toml-blocks.js — strings and comments are made inert before the
  // scanner reads a line; without that pass, a TOML snippet inside a key
  // binding's command reads as tables (#22 review, five shapes).
  [
    'lib/toml-blocks.js',
    "for (const raw of neutralize(text).split('\\n')) {",
    "for (const raw of text.split('\\n')) {",
    'config: a TOML snippet inside a string claims the table (#22 review)',
    true,
    'test/foreign-tables.test.js',
  ],
  [
    'lib/toml-blocks.js',
    "if (escapes && c === '\\\\') {",
    'if (false) {',
    'config: an escaped quote closes a basic string (#22 review)',
    true,
    'test/foreign-tables.test.js',
  ],
  [
    'lib/toml-blocks.js',
    "const FILLER = '·';",
    "const FILLER = '_';",
    'config: the filler spells a bare key, so "rows#by#agent" reads as rows_by_agent (#22 review)',
    true,
    'test/foreign-tables.test.js',
  ],
  [
    'lib/toml-blocks.js',
    'delimiter.length === 3 && extra < 2 && text[i] === delimiter[0]',
    'false',
    'config: a string ending in four quotes opens another (#22 review)',
    true,
    'test/foreign-tables.test.js',
  ],
  [
    'lib/toml-blocks.js',
    'open = Math.max(0, brackets(line.slice(key[0].length - key[2].length)));',
    'open = 0;',
    'config: an array element on its own line reads as a header (#22 review)',
    true,
    'test/foreign-tables.test.js',
  ],
  [
    'lib/toml-blocks.js',
    'if (current === table) return true;',
    'if (current === table || current.startsWith(under)) return true;',
    'config: a sub-table header claims its parent (#22 review)',
    true,
    'test/foreign-tables.test.js',
  ],
  [
    'lib/toml-blocks.js',
    'if (current && !table.startsWith(`${current}.`)) continue;',
    '',
    'config: a key under a sub-table claims the parent (#22 review)',
    true,
    'test/foreign-tables.test.js',
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

function withEdit(file, from, to, label, expectCaught = true, via = 'check') {
  const target = path.join(root, file);
  const original = fs.readFileSync(target);
  const text = original.toString('utf8');
  if (!text.includes(from)) throw new Error(`${label}: anchor missing in ${file}`);
  if (text.split(from).length !== 2) throw new Error(`${label}: anchor not unique in ${file}`);
  let result;
  try {
    fs.writeFileSync(target, text.replace(from, to), 'utf8');
    result = run(via);
  } finally {
    fs.writeFileSync(target, original);
  }
  const caught = result.code !== 0;
  const ok = caught === expectCaught;
  // The invariants print one problem per line; the test runner prints a tree,
  // where the failing assertion's own message is the useful line.
  const lines = result.text.split('\n').map((line) => line.trim());
  const firstLine =
    (via === 'check'
      ? lines.find((line) => /: |block:/.test(line))
      : lines.find((line) => /^(✖|not ok|error:|AssertionError|Error:)/.test(line) && !/tests? failed/.test(line))) ??
    lines[0] ??
    '';
  console.log(`${ok ? 'ok  ' : 'BAD '} ${caught ? 'caught  ' : 'passed  '} ${label}`);
  if (!ok || caught) console.log(`      ${firstLine.slice(0, 140)}`);
  return ok;
}

const baseline = allGreen();
if (!baseline.ok) {
  console.error(`the checks or the tests fail as they stand; fix that before proving anything:\n${baseline.text}`);
  process.exit(2);
}

const results = cases.map(([file, from, to, label, expectCaught, via]) =>
  withEdit(file, from, to, label, expectCaught, via),
);
const after = allGreen();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} shapes behaved; tree restored: ${after.ok ? 'yes' : 'NO'}`);
process.exitCode = failed === 0 && after.ok ? 0 : 1;
