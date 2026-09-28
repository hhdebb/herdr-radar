'use strict';

// Another plugin's workspace tokens get onto the sidebar only through the
// managed Spaces rows, since the block owns [ui.sidebar.spaces] whole.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function sidebarWith(settings) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-extra-'));
  fs.writeFileSync(path.join(dir, 'config.toml'), settings);
  const previous = process.env.HERDR_PLUGIN_CONFIG_DIR;
  process.env.HERDR_PLUGIN_CONFIG_DIR = dir;
  for (const id of Object.keys(require.cache)) {
    if (id.includes(`${path.sep}lib${path.sep}`)) delete require.cache[id];
  }
  try {
    return require('../lib/managed-config').sidebarBlock('light');
  } finally {
    if (previous === undefined) delete process.env.HERDR_PLUGIN_CONFIG_DIR;
    else process.env.HERDR_PLUGIN_CONFIG_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const spacesRows = (block) => block.slice(block.indexOf('[ui.sidebar.spaces]'));

test('without the setting the Spaces rows stay as they were', () => {
  const rows = spacesRows(sidebarWith(''));
  assert.equal((rows.match(/^ {2}\[$/gm) ?? []).length, 2);
  assert.doesNotMatch(rows, /status_line/);
});

test('space_extra_row adds one more Spaces row with those tokens', () => {
  const rows = spacesRows(sidebarWith('space_extra_row = "$status_line $build_status"'));
  assert.equal((rows.match(/^ {2}\[$/gm) ?? []).length, 3);
  assert.match(rows, /token = "\$status_line"/);
  assert.match(rows, /token = "\$build_status"/);
});

test('anything but a $name token is dropped, never written into config.toml', () => {
  const rows = spacesRows(sidebarWith(`space_extra_row = "workspace $ok $bad-name"`));
  assert.match(rows, /token = "\$ok"/);
  assert.doesNotMatch(rows, /token = "workspace"/);
  assert.doesNotMatch(rows, /bad-name/);
});
