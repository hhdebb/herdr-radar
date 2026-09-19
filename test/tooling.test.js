'use strict';

// AC7 — the wiring that makes the rest of this directory run anywhere but on
// the machine it was written on. A suite nobody executes is a suite that goes
// stale silently, which is the same argument ci.yml already makes for
// tools/check.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { REPO } = require('./helpers');

// No directory argument, deliberately. `node --test test/` resolves the
// directory as a module on Node 22 and 24 (`Cannot find module '/app/test'`)
// while Node 20 and 26 expand it, so the explicit form is broken on exactly
// the versions between the one CI pins and the one this was written on.
// Argument-less, the runner applies its own file patterns from the working
// directory and finds test/*.test.js on 20, 22, 24 and 26 alike — measured, all
// four in containers. It also skips node_modules, including the copies other
// tools drop into this checkout.
test('AC7a package.json startet die Suite über npm test', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));

  assert.equal(
    pkg.scripts?.test,
    'node --test',
    `package.json scripts.test ist ${JSON.stringify(pkg.scripts?.test)}, erwartet "node --test"`,
  );
});

test('AC7b ci.yml führt npm test direkt nach npm run check aus', () => {
  const lines = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'ci.yml'), 'utf8').split('\n');

  const at = lines.findIndex((line) => line.trim() === '- run: npm run check');
  assert.notEqual(at, -1, 'ci.yml ruft `npm run check` nicht mehr auf — die Verankerung für npm test fehlt');
  assert.equal(
    lines[at + 1]?.trim(),
    '- run: npm test',
    `ci.yml führt nach \`npm run check\` ${JSON.stringify(lines[at + 1]?.trim())} aus, erwartet \`- run: npm test\``,
  );
});
