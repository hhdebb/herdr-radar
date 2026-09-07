'use strict';

// The branch a directory is on, read straight from `.git/HEAD`.
//
// Herdr's own `branch` token follows the pane's launch directory, and the agent
// harnesses that print a branch read it once and cache it — so both go stale the
// moment an agent runs `git checkout` mid-session. Reading HEAD is always
// current, and it is only a file read: this runs on the tab-bar's two-second
// timer, where spawning `git` would be far too expensive (quirks §7).
//
// The cost of that choice: no dirty marker. Knowing whether the tree is clean
// means actually asking git, so the branch here is the branch and nothing more.

const fs = require('node:fs');
const path = require('node:path');

// `.git` is a directory in a normal clone and a file in a worktree or submodule,
// where it holds `gitdir: <path>` pointing at the real one.
function gitDir(start) {
  let dir = path.resolve(start);
  for (;;) {
    const candidate = path.join(dir, '.git');
    try {
      const stat = fs.statSync(candidate);
      if (stat.isDirectory()) return candidate;
      if (stat.isFile()) {
        const pointer = fs.readFileSync(candidate, 'utf8').match(/^gitdir:\s*(.+)$/m)?.[1]?.trim();
        if (pointer) return path.resolve(dir, pointer);
      }
    } catch {
      // Not here; keep walking up.
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function branch(cwd) {
  if (!cwd) return null;
  const dir = gitDir(cwd);
  if (!dir) return null;
  let head;
  try {
    head = fs.readFileSync(path.join(dir, 'HEAD'), 'utf8').trim();
  } catch {
    return null;
  }
  const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/)?.[1];
  if (ref) return ref;
  // Detached HEAD holds a raw sha. Seven characters is what git itself shows.
  return /^[0-9a-f]{7,40}$/i.test(head) ? head.slice(0, 7) : null;
}

module.exports = { branch };
