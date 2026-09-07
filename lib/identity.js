'use strict';

// Everything that carries this plugin's name, in one place, so a rename is
// one edit here plus the two declaration files (herdr-plugin.toml and
// package.json), which Herdr and npm read without running any code —
// `verify()` below is what keeps those two in step with this file.
//
// `LEGACY_NAMES` lists names this plugin has shipped under before: the
// managed blocks in Herdr's config.toml carry the name in their marker
// comments, and a rename must recognise the old markers to replace them
// rather than leaving orphans behind.

const NAME = 'herdr-radar';
const LEGACY_NAMES = ['herdr-kit'];

// Herdr's convention is `<github owner>.<repo>`; this is the fallback for a
// bare shell run, when Herdr has not injected HERDR_PLUGIN_ID.
const PLUGIN_ID = 'hhdebb.herdr-radar';

// Prefix of the environment variables this plugin reads for overrides.
const ENV_PREFIX = 'HERDR_RADAR';

// Suffix of the temp file an atomic rewrite of Herdr's config goes through.
const TMP_SUFFIX = `.${NAME}.tmp`;

// The marker comments that fence a managed block in Herdr's config.toml.
function markers(block, name = NAME) {
  return { start: `# >>> ${name} ${block} block`, end: `# <<< ${name} ${block} block` };
}

function env(suffix) {
  return process.env[`${ENV_PREFIX}_${suffix}`];
}

// Check the two declaration files against this module. Returns a list of
// mismatches; empty means consistent.
function verify(root) {
  const fs = require('node:fs');
  const path = require('node:path');
  const problems = [];
  const manifest = fs.readFileSync(path.join(root, 'herdr-plugin.toml'), 'utf8');
  const id = manifest.match(/^id\s*=\s*"([^"]+)"/m)?.[1];
  if (id !== PLUGIN_ID) problems.push(`herdr-plugin.toml id is ${id}, lib/identity.js says ${PLUGIN_ID}`);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (pkg.name !== NAME) problems.push(`package.json name is ${pkg.name}, lib/identity.js says ${NAME}`);
  const version = manifest.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (version !== pkg.version) problems.push(`versions differ: manifest ${version}, package.json ${pkg.version}`);
  return problems;
}

module.exports = { NAME, LEGACY_NAMES, PLUGIN_ID, ENV_PREFIX, TMP_SUFFIX, markers, env, verify };
