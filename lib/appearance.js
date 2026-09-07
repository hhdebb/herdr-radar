'use strict';

// Which appearance the desktop is in, and keeping the theme block in step.
//
// Herdr can already follow the host between a light and a dark theme
// (`auto_switch`), but `[theme.custom]` is a single static table applied to
// whichever theme is live — so an override picked for a light panel is wrong
// every night. Nothing in the config file can express "this value when light,
// that one when dark".
//
// So the plugin does what the config cannot: read the desktop's appearance,
// and when it flips, rewrite the managed theme block and reload. Herdr swaps
// the theme, we swap the one token we own, and the two stay in agreement.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { stateRoot, ensureDir } = require('./paths');

// A desktop-appearance switch happens twice a day at most, while the caller
// (the tab-bar renderer) runs every couple of seconds. Probing the OS on every
// frame would spend a process per tick for an answer that almost never changes.
const PROBE_INTERVAL_MS = 60_000;

const CACHE = () => path.join(stateRoot, 'appearance.json');

function probe() {
  if (process.platform === 'win32') {
    // 0 = apps use the dark theme, 1 = light. Absent on older builds.
    const out = spawnSync(
      'reg',
      [
        'query',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize',
        '/v',
        'AppsUseLightTheme',
      ],
      { encoding: 'utf8', timeout: 3000, windowsHide: true },
    );
    const value = out.stdout?.match(/AppsUseLightTheme\s+REG_DWORD\s+0x([0-9a-f]+)/i)?.[1];
    if (value === undefined) return null;
    return value === '0' ? 'dark' : 'light';
  }
  if (process.platform === 'darwin') {
    // The key exists only in dark mode; light mode leaves it unset.
    const out = spawnSync('defaults', ['read', '-g', 'AppleInterfaceStyle'], {
      encoding: 'utf8',
      timeout: 3000,
    });
    return out.status === 0 && /dark/i.test(out.stdout ?? '') ? 'dark' : 'light';
  }
  if (process.platform === 'linux') {
    const out = spawnSync('gsettings', ['get', 'org.gnome.desktop.interface', 'color-scheme'], {
      encoding: 'utf8',
      timeout: 3000,
    });
    if (out.status !== 0) return null;
    return /dark/i.test(out.stdout ?? '') ? 'dark' : 'light';
  }
  return null;
}

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE(), 'utf8'));
  } catch {
    return {};
  }
}

function writeCache(entry) {
  try {
    ensureDir(path.dirname(CACHE()));
    fs.writeFileSync(CACHE(), JSON.stringify(entry), 'utf8');
  } catch {
    // A cache that cannot be written only costs an extra probe next time.
  }
}

// Is a probe due? One file read, cheap enough for a caller that runs every
// couple of seconds and wants to know whether forking is worth it at all.
function probeDue(now = Date.now()) {
  return now - (readCache().at ?? 0) >= PROBE_INTERVAL_MS;
}

// The current appearance, throttled. Returns null where the platform has no
// answer for us — callers must treat that as "leave things alone".
function current(now = Date.now(), { fresh = false } = {}) {
  const cached = readCache();
  if (!fresh && cached.value && now - (cached.at ?? 0) < PROBE_INTERVAL_MS) return cached.value;
  const value = probe();
  // Merge, never replace: `applied` is what takeChange() compares against to
  // decide whether the desktop actually flipped. Dropping it here made every
  // probe — one a minute — look like a change, so the resident daemon rewrote
  // the managed theme and sidebar blocks on a timer. With a long-lived
  // process that is worse than wasted work: the daemon writes from the module
  // copy it loaded at startup, so it kept reverting edits made to the palette
  // since.
  if (value) writeCache({ ...cached, value, at: now });
  return value ?? cached.value ?? null;
}

// Has it changed since we last acted on it? Records the new value so the
// caller acts exactly once per flip.
function takeChange(now = Date.now()) {
  const value = current(now);
  if (!value) return null;
  const cached = readCache();
  if (cached.applied === value) return null;
  writeCache({ ...cached, value, at: cached.at ?? now, applied: value });
  return value;
}

module.exports = { current, takeChange, probeDue, PROBE_INTERVAL_MS };
