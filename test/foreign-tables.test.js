'use strict';

// A table the user already owns is refused in every form TOML can spell it
// (#22). Only the `[theme.custom]` header on a line of its own used to be
// seen; a dotted key or an inline table on the way down slipped past, the
// block was appended, and the whole config.toml stopped parsing.

const test = require('node:test');
const assert = require('node:assert/strict');

const { claimsTable } = require('../lib/toml-blocks');
const managed = require('../lib/managed-config');
const identity = require('../lib/identity');

const claims = [
  ['a header', '[theme.custom]\nname = "x"'],
  ['an indented header', '  [theme.custom]'],
  ['a header with a comment after it', '[theme.custom] # mine'],
  ['a header with spaces inside the brackets', '[ theme.custom ]'],
  ['a quoted header', '[theme."custom"]'],
  ['an array-of-tables header', '[[theme.custom]]'],
  ['a dotted key under the parent', '[theme]\ncustom.name = "x"'],
  ['a dotted key at the top level', 'theme.custom.name = "x"'],
  ['an inline table', '[theme]\ncustom = { name = "x" }'],
  ['an inline table above it', 'theme = { custom = { name = "x" } }'],
  ['a scalar where the table would go', '[theme]\ncustom = 1'],
  ['a dotted key with a quoted segment', '[theme]\n"custom".name = 1'],
  // A string, a comment or an escape before it leaves the scanner reading.
  ['a header after a multi-line string in an array', '[ui]\nx = [ """\ntext\n""" ]\n[theme.custom]'],
  ['a header after a comment shaped like an opener', '[ui]\nx = 1 # = """\n[theme.custom]'],
  ['a header after an even run of backslashes', '[ui]\nx = """abc\\\\"""\n[theme.custom]'],
];

for (const [form, toml] of claims) {
  test(`${form} claims the table`, () => {
    assert.equal(claimsTable(toml, 'theme.custom'), true);
  });
}

const free = [
  ['the parent table alone', '[theme]\nname = "x"'],
  ['a sibling key', '[theme]\ncustom_name = "x"'],
  ['a sibling table', '[theme.customs]'],
  ['the same key under another table', '[ui]\ncustom.name = "x"'],
  ['a commented-out header', '# [theme.custom]'],
  ['the name inside a value', '[theme]\nname = "[theme.custom]"'],
  // Codex found this one: a key binding whose command is a heredoc that
  // writes TOML. The lines inside are text.
  [
    'a header inside a multi-line string',
    '[[keys.command]]\ncommand = """\ncat <<EOF\n  [theme.custom]\nEOF\n"""\n[ui]',
  ],
  ['a header inside a literal multi-line string', "[keys]\nx = '''\n[theme.custom]\n'''"],
  ['a multi-line string closed on its own line', '[keys]\nx = """abc"""\n[ui]\ny = 1'],
  // TOML lets a parent table be declared after its sub-table.
  ['a sub-table header', '[theme.custom.accent]\nfg = "x"'],
  // Codex again, second round: a comment shaped like an opener, and an
  // escaped quote inside a basic multi-line string.
  ['a comment shaped like a string opener, then the real scope', '[ui]\n# x = """\n[other] # """\nsidebar.spaces = 1'],
  ['a header inside a string past an escaped quote', '[keys]\nx = """\necho \\"""\n  [theme.custom]\n"""'],
  // Codex, third round: strings do not respect lines, so the scanner must
  // not either. Each of these fooled a per-line reading.
  ['a multi-line string inside an array', '[ui]\nx = [ """\n  [theme.custom]\n"""]'],
  [
    'a second string opened on the line that closed the first',
    '[ui]\nx = { a = """ok""", b = """\n  [theme.custom]\n""" }',
  ],
  ['an opener inside a comment after a value', '[theme]\nx = 1 # = """\n[other] # """\ncustom.name = 1'],
  ['an opener inside a one-line string', '[theme]\nx = \'= """\'\n[other]\ncustom.name = 1'],
  ['an opener inside a quoted key', '[theme]\n\'x = """\' = 1\n[other]\ncustom.name = 1'],
  [
    'an even run of backslashes before the closing quotes',
    '[theme]\nx = """abc\\\\"""\n[other] # """\ncustom.name = 1',
  ],
  ['a bracket inside a quoted header name', '[theme]\n["a]b"]\ncustom.name = 1'],
  ['a bracket inside a quoted header segment', '[theme]\n[other."a]b"]\ncustom.name = 1'],
  ['CRLF line endings', '[theme]\r\nname = "x"\r\n[other]\r\ncustom.name = 1\r\n'],
  // Codex, fourth round: the filler must not spell a bare key, and a
  // multi-line string may end in four or five quotes.
  ['a quoted name that differs only in the neutralized characters', '[theme."cus#tom"]\nx = 1'],
  ['a literal quoted name with a backslash', "[theme.'cus\\tom']\nx = 1"],
  [
    'a string ending in four quotes, then a comment with more',
    '[theme]\nx = """abc"""" # """"\n[other] # """\ncustom.name = 1',
  ],
  ['a literal string ending in five quotes', "[theme]\nx = '''abc'''''\n[other]\ncustom.name = 1"],
  // Codex, fifth round: an array element on a line of its own is not a
  // header.
  ['a nested array element shaped like a header', '[theme]\n[other]\nx = [\n["theme"]\n]\ncustom.name = 1'],
  ['a nested array-of-arrays element', "[theme]\n[other]\nx = [\n[['theme']]\n]\ncustom.name = 1"],
  ['an array of inline tables, one per line', '[theme]\n[other]\nx = [\n  { custom = 1 },\n]\ncustom.name = 1'],
];

// Brackets closed leave the scanner reading again.
test('a table after a multi-line array is still seen', () => {
  assert.equal(claimsTable('[other]\nx = [\n  1,\n  [2],\n]\n[theme.custom]', 'theme.custom'), true);
  assert.equal(claimsTable('[other]\nx = [ [1], [2] ]\n[theme.custom]', 'theme.custom'), true);
});

// A string that closes leaves the scanner reading again.
test('a table after a multi-line string is still seen', () => {
  assert.equal(claimsTable('[keys]\nx = """\ntext\n"""\n[theme.custom]', 'theme.custom'), true);
});

// The filler that replaces a neutralized character must never spell a bare
// key: with `_` these read as our own rows_by_agent table.
test('a quoted name is never read as the bare name the filler would spell', () => {
  const table = 'ui.sidebar.agents.rows_by_agent';
  assert.equal(claimsTable('[ui.sidebar.agents."rows#by#agent"]\nx = 1', table), false);
  assert.equal(claimsTable("[ui.sidebar.agents.'rows\\by_agent']\nx = 1", table), false);
  assert.equal(claimsTable('[ui.sidebar.agents]\n"rows.by.agent" = 1', table), false);
});

// A comment shaped like an opener must not hide a real table after it.
test('a table after a comment shaped like a string opener is still seen', () => {
  assert.equal(claimsTable('[ui]\n# x = """\n[ui.sidebar.spaces]\nrow_gap = 1', 'ui.sidebar.spaces'), true);
});

for (const [form, toml] of free) {
  test(`${form} does not claim the table`, () => {
    assert.equal(claimsTable(toml, 'theme.custom'), false);
  });
}

// The reporter's own file: `[ui.sidebar.spaces]` written by hand.
test('a hand-written sidebar table is foreign', () => {
  const toml = '[ui]\nstatus_indicators = "symbols"\n\n[ui.sidebar.spaces]\nrow_gap = 1\n';
  assert.deepEqual(managed.foreignTables(toml), ['ui.sidebar.spaces']);
});

// The plugin's own blocks are never counted against it.
test('the managed blocks are not foreign', () => {
  const theme = identity.markers('theme');
  const sidebar = identity.markers('sidebar');
  const toml = [
    '[ui]',
    '',
    theme.start,
    '[theme.custom]',
    'fg = "x"',
    theme.end,
    '',
    sidebar.start,
    '[ui.sidebar.agents]',
    '[ui.sidebar.agents.rows_by_agent]',
    '[ui.sidebar.spaces]',
    sidebar.end,
    '',
  ].join('\n');
  assert.deepEqual(managed.foreignTables(toml), []);
});
