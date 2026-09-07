'use strict';

// Rendering helpers.
//
// Herdr's tab bar strips the ESC byte out of ANSI sequences but keeps the rest,
// so `\x1b[31m` renders as a literal "[31m". Every signal in this status line
// has to survive as plain text — health shows up as `!` / `!!`, never colour.

const os = require('node:os');
const path = require('node:path');

const WINDOW_SECONDS = { '5h': 5 * 3600, week: 7 * 24 * 3600 };

function percent(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(Math.min(100, Math.max(0, value)));
}

// "2d3h" / "2h13m" / "47m" / "<1m"
function duration(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  const total = Math.round(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}d${hours}h`;
  if (hours > 0) return `${hours}h${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return '<1m';
}

function resetIn(resetsAt, now = Date.now()) {
  const stamp = typeof resetsAt === 'number' ? resetsAt * 1000 : Date.parse(resetsAt ?? '');
  if (Number.isNaN(stamp)) return null;
  return duration((stamp - now) / 1000);
}

// Home-relative, forward-slashed, and elided from the left when long: a status
// line that pushes the tabs off screen is worse than one that abbreviates.
function shortenPath(cwd, maxLength = 34) {
  if (!cwd) return null;
  let text = String(cwd).replace(/\\/g, '/').replace(/\/+$/, '');
  const home = os.homedir().replace(/\\/g, '/').replace(/\/+$/, '');
  if (home && text.toLowerCase().startsWith(home.toLowerCase())) {
    text = `~${text.slice(home.length)}`;
  }
  if (text.length <= maxLength) return text || '/';

  const parts = text.split('/');
  while (parts.length > 2 && parts.join('/').length > maxLength) {
    parts.shift();
  }
  return `…/${parts.join('/')}`;
}

module.exports = {
  WINDOW_SECONDS,
  percent,
  duration,
  resetIn,
  shortenPath,
  basename: (cwd) => (cwd ? path.basename(String(cwd).replace(/\\/g, '/')) : null),
};
