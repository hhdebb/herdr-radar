'use strict';

// A value is written into the file as it is (lib/toml-blocks.js).
//
// The edit is a `String.replace`, and a replacement STRING is a small language
// of its own: `$&` is the matched text, `$$` a single dollar. Every value used
// to be a number, a colour or a word; a free-text setting is the first one
// that can carry a dollar sign, and it came back as something else.

const test = require('node:test');
const assert = require('node:assert/strict');

const { editTopLevel, editTable } = require('../lib/toml-blocks');

test('a dollar sign in a top-level value is kept', () => {
  const edited = editTopLevel('row_format = "old"\n', { row_format: '"cost $$5 $& x"' });
  assert.equal(edited, 'row_format = "cost $$5 $& x"\n');
});

test('a dollar sign in a table value is kept', () => {
  const edited = editTable('[colors]\nname = "old"\n', 'colors', { name: '"$& $$"' });
  assert.equal(edited, '[colors]\nname = "$& $$"\n');
});
