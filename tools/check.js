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
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('ok');
