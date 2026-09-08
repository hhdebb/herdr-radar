'use strict';

// Which mark stands for which agent.
//
// The font variant uses Private Use Area codepoints from the bundled
// HerdrAgentIconsMax face; the text variant uses ordinary Unicode that renders
// in any terminal font. `auto` picks the font when the terminal can actually
// reach it, which on Linux means asking Fontconfig — macOS and Windows have no
// equivalent query, so there `auto` stays conservative and uses text. Set
// `variant = "font"` explicitly once the font is installed.

const { spawnSync } = require('node:child_process');
const config = require('./config');

const FONT_FAMILY = 'Herdr Agent Icons Max';

const PUA = {
  claude: '',
  codex: '',
  opencode: '',
  omp: '',
  cline: '',
  mastracode: '',
  kimi: '',
  kilo: '',
  maki: '',
  pi: '',
  hermes: '',
  cursor: '',
  copilot: '',
  deepseek: '',
  gemini: '',
  gpt: '',
  qwen: '',
  grok: '',
};

// The lifecycle marks live in our own font for the same reason the logos do:
// `✓ ○ ◌` are missing from plenty of monospace faces, and a terminal that falls
// back to a CJK face draws them at full width — a circle sized for a Han
// character sitting next to text that is not. Borrowed Unicode looked fine on
// Windows and oversized on macOS purely by luck of the fallback chain.
// The three idle tiers deliberately share ONE mark. They used to differ in
// shape as well as colour \u2014 filled disc, ring, dot \u2014 because shape survives
// where colour fails. That was written when the sidebar had no ordering and
// the tier was the only way to find a live session among thirty. Sorting by
// activity does that job now, so three shapes for one concept became noise:
// a column of identical marks with a colour gradient reads faster than three
// glyphs the eye must first learn. E1C4/E1C5 stay in the font, unused, so
// this is three lines to revert.
//
// The mark is the RING and not the dot because it shares its row with Herdr's
// cell separator, which is itself a middot \u2014 a dot that means "state" and a
// dot that means "next field" are the same handful of pixels. The ring is
// scaled down in font/codepoints.toml so it still reads as a marker beside
// the title rather than a bullet in front of it.
// `working` takes the same ring as the idle tiers rather than a spinner of
// its own: the motion is the braille frames in front of the title, and two
// things animating inside one entry fight each other. Its ring is painted in
// the brand colour, so the row still says "this one is busy" at a glance.
const STATE_PUA = {
  working: '',
  done: '\ue1c0',
  blocked: '\ue1c1',
  idle: '\ue1c2',
  unknown: '\ue1c3',
  idle_fresh: '\ue1c2',
  idle_stale: '\ue1c2',
};

// The working spinner's frames, in the font. A terminal without the font
// falls back to the braille frames in lib/config.js — they say the same thing
// with characters every face has.
const THROB_FRAMES = Array.from({ length: 12 }, (_, index) => String.fromCodePoint(0xe1c6 + index));

function throbFrame(step, variant = config.variant) {
  if (resolveVariant(variant) !== 'font') return config.FRAMES[step % config.FRAMES.length];
  return THROB_FRAMES[step % THROB_FRAMES.length];
}

const TEXT = {
  claude: '§',
  codex: 'Λ',
  opencode: '◇',
  omp: 'Π',
  cline: '∇',
  mastracode: '∑',
  kimi: '✨',
  kilo: '♟',
  maki: '✳',
  pi: 'π',
  hermes: '☪',
  cursor: '◆',
  copilot: '⊙',
  deepseek: '≋',
  gemini: '✦',
  gpt: '✺',
  qwen: 'Ϙ',
  grok: '✖',
};

let fontChecked = false;
let fontPresent = false;

function fontAvailable() {
  if (fontChecked) return fontPresent;
  fontChecked = true;
  // The copy this plugin installed itself (bin/install-font.js) counts on
  // every platform; fontconfig below is the only other oracle, Linux-only.
  try {
    if (require('./font').isInstalled()) return (fontPresent = true);
  } catch {
    // Fall through to fontconfig.
  }
  try {
    const result = spawnSync('fc-match', ['--format', '%{family}\n', FONT_FAMILY], {
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true,
    });
    fontPresent =
      result.status === 0 &&
      String(result.stdout)
        .split(/[\n,]/)
        .some((name) => name.trim() === FONT_FAMILY);
  } catch {
    fontPresent = false;
  }
  return fontPresent;
}

// Which of the two glyph tables is in play. `auto` asks whether the icon font
// is actually installed; every other value is taken at its word.
function resolveVariant(variant = config.variant) {
  if (variant === 'none') return 'none';
  return variant === 'auto' ? (fontAvailable() ? 'font' : 'text') : variant;
}

// vendor -> the exact string this machine will publish for it. The sidebar
// block matches on these values (managed-config colours `$logo` by rule), so
// the block and the daemon have to read the table through the same door.
function glyphs(variant = config.variant) {
  const resolved = resolveVariant(variant);
  if (resolved === 'none') return {};
  return { ...(resolved === 'font' ? PUA : TEXT) };
}

// The mark for `agent`, or null when this agent has none. Agents Herdr detects
// but this plugin has no mark for are left unmarked rather than given a
// stand-in that would read as the wrong vendor.
function logoFor(agent, variant = config.variant) {
  if (!agent || !(agent in PUA) || variant === 'none') return null;
  const resolved = resolveVariant(variant);
  return resolved === 'font' ? PUA[agent] : TEXT[agent];
}

// The mark for a lifecycle state. An explicit config choice always wins;
// otherwise the variant decides, exactly as it does for logos. `none` is not
// honoured here — a state line with no state mark is not a state line.
function stateGlyph(state, variant = config.variant) {
  const chosen = config.userGlyph(state);
  if (chosen) return chosen;
  const resolved = resolveVariant(variant);
  // A state the face has no mark for falls back to its text mark rather than
  // to nothing: a missing glyph swallows the whole state line, and a pane with
  // no state line renders as a bare title at the margin — which reads as a
  // group header. That is how idle_fresh painted a second workspace title.
  if (resolved === 'font' && STATE_PUA[state]) return STATE_PUA[state];
  return config.STATIC_GLYPH[state];
}

module.exports = {
  logoFor,
  throbFrame,
  glyphs,
  resolveVariant,
  stateGlyph,
  STATE_PUA,
  PUA,
  TEXT,
  FONT_FAMILY,
  fontAvailable,
};
