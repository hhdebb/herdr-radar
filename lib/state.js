'use strict';

// The sidebar line for each agent pane, and the grouping around it.
//
// Everything a pane shows is packed into ONE token, because Herdr joins
// adjacent row cells with `·` and there is no way to turn that off. One token
// also means one colour per line — which is exactly what is wanted here, since
// the colour carries the state.
//
// State is encoded in *which* token name is set (`state_working`,
// `state_done`, …), because Herdr's row styles are static: a style is bound to
// a token name, not to its value, so "turn red when blocked" is only
// expressible as "publish a differently-named token that the row paints red".
// The names not in use must be cleared explicitly or the old one keeps
// rendering beside the new.

const path = require('node:path');
const fs = require('node:fs');

const herdr = require('./herdr');
const config = require('./config');
const hook = require('./hook');
const { stateRoot, ensureDir } = require('./paths');
const { logoFor, stateGlyph } = require('./logos');

// `idle_fresh` and `idle_stale` are idle split by how long ago the pane last
// worked (lib/activity.js). Herdr knows nothing about them — they exist only as
// token names, which is exactly how this plugin colours anything (quirks §1).
const STATES = ['working', 'done', 'blocked', 'idle_fresh', 'idle', 'idle_stale', 'unknown'];

// Each idle shade has its own mark (● ○ ·), so nothing collapses here. Shape
// carries the distinction rather than colour alone, because a colour's meaning
// flips with the background — the same grey that reads as prominent on a dark
// terminal reads as faded on a light one, which is exactly how the first
// attempt at this came out backwards.
function baseState(display) {
  return display;
}

// Herdr trims leading whitespace off a token value, so a plain-space indent
// disappears. A zero-width space is a format character rather than whitespace:
// it survives the trim and protects the spaces after it.
const INDENT =
  config.groupIndentWidth > 0 ? `​${' '.repeat(config.groupIndentWidth)}` : '';

// A worktree's sessions sit one level deeper than the checkout they hang off,
// so the branch drawn on their header has something to enclose. One zero-width
// space and double the spaces — not INDENT twice, which would bury a second
// format character mid-string for no reason.
const CHILD_INDENT =
  config.groupIndentWidth > 0 ? `​${' '.repeat(config.groupIndentWidth * 2)}` : '';

// Signal files live in stateRoot, not the system temp dir: the daemon watches
// one directory for every self-owned signal (stop marker, view flag), and
// temp-cleaning tools that delete a watched directory kill the watcher
// silently. stateRoot is ours and nobody sweeps it.
const LOCK = () => path.join(ensureDir(stateRoot), 'animator.pid');
const STOP = () => path.join(ensureDir(stateRoot), 'animator.stop');

function pidAlive(pid) {
  try {
    process.kill(pid, 0); // signal 0 only tests for existence
    return true;
  } catch (error) {
    return error.code === 'EPERM'; // alive, just not ours to signal
  }
}

function animatorRunning() {
  try {
    return pidAlive(Number.parseInt(fs.readFileSync(LOCK(), 'utf8').trim(), 10));
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------- collection */

// One entry per live agent pane, with everything a frame needs. Null when the
// list could not be fetched at all — which is not the same as no agents.
async function snapshot() {
  const agents = await herdr.agentsAsync();
  if (agents === null) return null;
  return agents.flatMap((a) => {
    const pane = a.pane_id;
    const status = a.agent_status;
    if (typeof pane !== 'string' || typeof status !== 'string') return [];
    const tokens = a.tokens && typeof a.tokens === 'object' ? a.tokens : {};
    return [
      {
        pane,
        status,
        name: hook.apply('agent', a.agent ?? '', pane),
        session: a.agent_session?.value ?? '',
        title: hook.apply('title', typeof a.terminal_title_stripped === 'string' ? a.terminal_title_stripped : '', pane),
        focused: Boolean(a.focused),
        tab: a.tab_id ?? '',
        workspace: a.workspace_id ?? '',
        // What the sidebar is showing right now. A held "done" cannot live in
        // this process — the animator exits as soon as nothing is animating —
        // so the published token doubles as the record.
        showing: Object.keys(tokens)
          .find((key) => key.startsWith('state_'))
          ?.slice('state_'.length),
      },
    ];
  });
}

const cache = {
  at: 0,
  tabs: new Map(),
  workspaces: new Map(),
  parents: new Map(),
  worktrees: new Map(),
};
const LABEL_TTL_MS = 5000;

// Which workspaces are Git worktrees cut from another open one, child -> parent.
//
// Herdr draws that tree in the Spaces panel natively and offers the Agents
// panel nothing: its rows take a fixed set of built-in cells plus our `$`
// tokens, and there is no depth among them. So the tree over there has to be
// drawn, and this is the input — free, because `workspace.list` already
// carries a `worktree` object per workspace and this function already calls it
// for the labels. Members of one repo share `repo_key`; the one that is not a
// linked worktree is the checkout the others were cut from.
//
// A repo whose main checkout is not open as a workspace yields no parent at
// all: its worktrees are top-level here, which is what they look like.
function worktreeParents(list) {
  const byRepo = new Map();
  // Every linked worktree, with the repo it was cut from. `repo_name` is on the
  // worktree object itself, so this survives the case the parents map cannot
  // cover: a worktree whose main checkout is not open as a workspace at all.
  const worktrees = new Map();
  for (const ws of list) {
    const key = ws.worktree?.repo_key;
    if (typeof key !== 'string' || typeof ws.workspace_id !== 'string') continue;
    if (ws.worktree.is_linked_worktree === true) {
      worktrees.set(ws.workspace_id, ws.worktree.repo_name ?? null);
    }
    if (!byRepo.has(key)) byRepo.set(key, []);
    byRepo.get(key).push(ws);
  }
  const parents = new Map();
  for (const members of byRepo.values()) {
    if (members.length < 2) continue;
    const parent = members.find((ws) => ws.worktree.is_linked_worktree === false);
    if (!parent) continue;
    for (const ws of members) {
      if (ws.workspace_id !== parent.workspace_id) parents.set(ws.workspace_id, parent.workspace_id);
    }
  }
  return { parents, worktrees };
}

// Tab and workspace labels, cached. A tab's label cannot be derived from its
// id: ids are unique per session (`w4:t5`) while labels restart per workspace,
// so `w4:t5` can be labelled 1.
async function labels(now) {
  if (now - cache.at < LABEL_TTL_MS && cache.tabs.size > 0) return cache;
  const tabs = new Map();
  for (const tab of await herdr.tabsAsync()) {
    if (typeof tab.tab_id === 'string' && typeof tab.label === 'string') tabs.set(tab.tab_id, tab.label);
  }
  const list = await herdr.workspacesAsync();
  const workspaces = new Map();
  for (const ws of list) {
    if (typeof ws.workspace_id === 'string' && typeof ws.label === 'string') {
      // A linked worktree's label is its branch name; the two go through
      // different hook functions because they read differently.
      const kind = ws.worktree?.is_linked_worktree === true ? 'branch' : 'workspace';
      workspaces.set(ws.workspace_id, hook.apply(kind, ws.label, ws.workspace_id));
    }
  }
  const { parents, worktrees } = worktreeParents(list);
  if (tabs.size > 0) Object.assign(cache, { at: now, tabs, workspaces, parents, worktrees });
  return cache;
}

// Titles that begin with the workspace's own name, under a group header that
// already says it: the name is written twice on every row and eats the width
// the rest of the title needs. Claude Code used to compose titles that way and
// Herdr's own fallback title still does (`<workspace> · <prompt> · <session>`),
// so this is not one agent's quirk to wait out.
//
// Only an exact header match followed by a separator is dropped, and only when
// something is left over — `billing · billing` keeps its tail, `api-gateway`
// under a header of `api` is untouched because the boundary is not there. The
// caller passes an empty label in the flat view, where no header exists and the
// workspace name is the only context a row carries.
const PREFIX_SEPARATOR = /^(?:\s*[·・‧|»]\s*|\s*:\s+|\s+[-—–]\s+)/;

function trimGroupPrefix(title, label) {
  if (!label || !title.startsWith(label)) return title;
  const rest = title.slice(label.length);
  const separator = rest.match(PREFIX_SEPARATOR);
  if (!separator) return title;
  return rest.slice(separator[0].length).trim() || title;
}

/* ---------------------------------------------------------------- writing */

// The line, split where its colours want to split: the state mark carries the
// freshness tier, the label carries the vendor. They are two tokens because a
// token is one colour — the cost is the ` · ` Herdr puts between any two
// visible cells in a row, which is the same trade the Spaces list already
// makes to keep each vendor's logo in its own brand colour.
function composeLine(entry, display, tabLabel, indent, step = 0) {
  const glyph = stateGlyph(baseState(display));
  if (!glyph) return null;

  const mark = [];
  if (tabLabel) mark.push(tabLabel);
  mark.push(glyph);

  // An entry is ONE row: `logo · title`. Everything else was repetition —
  // the vendor's name says what its logo already said, and a state mark says
  // what the title's own colour now says. Two rows per session cost sixty
  // rows for thirty sessions, and the second one carried no information the
  // first did not.
  //
  // The mark is still composed, and still published: it is not rendered, but
  // `snapshot()` reads which `state_*` name is set to recover a held done
  // badge or an unanswered question after the daemon restarts.
  //
  // The indent belongs to whichever cell comes first, because Herdr only
  // hangs its own indent on an entry's continuation rows — and with one row
  // per entry, a member pane's row IS the first row.
  const logo = logoFor(entry.name);

  // Motion rides in front of the TITLE, not on the mark. A logo in a terminal
  // cell can only move a few pixels, and a few pixels of moving leg or eye is
  // a twitch you have to already be looking at; a spinner ahead of a sentence
  // has the whole row to be noticed from. It is also where the agents that
  // announce themselves put it — grok writes "- Thinking -" into its terminal
  // title — except doing it here covers every agent instead of the ones whose
  // CLI happens to.
  // Which states earn a mark in front of the title. The three idle tiers do
  // not: their colour already says how long ago, and a mark on every row is a
  // column of marks, which is no signal at all. The rest are events — still
  // running, finished and unseen, waiting on an answer, unrecognised — and an
  // event deserves something the eye catches without reading the colour.
  const lead =
    display === 'working'
      ? config.FRAMES[step % config.FRAMES.length]
      : ['done', 'blocked', 'unknown'].includes(display)
        ? glyph
        : '';
  const spin = lead ? `${lead} ` : '';
  // The tab label, when asked for, rides in front of the title too: the mark
  // that used to carry it is published but no longer rendered.
  const tab = tabLabel ? `${tabLabel} ` : '';
  return {
    mark: mark.join(' '),
    logo: logo ? indent + logo : '',
    titlePrefix: (logo ? '' : indent) + tab + spin,
  };
}

// The title travels the same one-token-per-state road as the state line
// (`title_working`, `title_idle_stale`, …), for the same reason: row styles
// are static per token name, so "dim the title when its session is stale" is
// only expressible as a differently-named token the row paints dim. The value
// is Herdr's own terminal title, republished under a state-coloured name.
// Both resolve to whether the write actually landed. Callers cache "what this
// pane shows" to skip redundant writes, and caching a FAILED write pins the
// pane to a token it never got — a transient socket timeout then reads as a
// permanently wrong (or missing) line until the value happens to change.
// Three token families, all keyed by state: the vendor label, the state mark,
// the title. Keying the LABEL by state as well is what lets a stale session
// recede as a whole — its logo and name fade with its mark and title instead
// of staying in full brand colour, which is the entry's loudest ink. Only one
// member of each family is ever set, so a row holding a whole family still
// renders a single cell and pays no separator.
// One report may carry at most 16 tokens — the whole patch is rejected past
// that, not truncated, and a rejected patch is silent from the sidebar's side:
// the row simply never appears. Three seven-member families plus the sort keys
// is 21, so every write here goes out in chunks.
const MAX_TOKENS_PER_REPORT = 16;

function reportChunked(source, pane, tokens) {
  const names = Object.keys(tokens);
  const chunks = [];
  for (let at = 0; at < names.length; at += MAX_TOKENS_PER_REPORT) {
    const patch = {};
    for (const name of names.slice(at, at + MAX_TOKENS_PER_REPORT)) patch[name] = tokens[name];
    chunks.push(herdr.reportMetadataAsync(pane, source, patch));
  }
  return Promise.all(chunks).then((results) => results.every(Boolean));
}

// Four token families, every one keyed by state: vendor logo, vendor name,
// state mark, title. Keying all four — not just the mark — is what lets a
// stale session recede as a WHOLE: logo, name and title fade together rather
// than the logo sitting there in full brand colour, which is an entry's
// loudest ink. Only one member of a family is ever set, so a row holding
// whole families still renders one cell per family.
// `working` publishes its logo under one of TWO names, alternating with the
// caller's `pulse` phase. The row config paints one plainly and the other
// with `dim`, so the mark breathes in its own brand colour — and it breathes
// by way of the terminal's dim rendering, which blends toward whatever is
// actually behind the panel. A hand-picked darker hex cannot: the direction
// that reads as "faded" flips between a light and a dark panel, and neither
// knows about a wallpaper showing through.
function writeState(source, pane, display, line, title, pulse = false) {
  const tokens = { logo_working_dim: null };
  for (const state of STATES) {
    const current = state === display;
    const logo = current && line.logo ? line.logo : null;
    if (state === 'working' && pulse) {
      tokens.logo_working_dim = logo;
      tokens.logo_working = null;
    } else {
      tokens[`logo_${state}`] = logo;
    }
    // The vendor's name is gone from the layout; keep nulling its old token
    // so a pane that has one from a previous version loses it.
    tokens[`name_${state}`] = null;
    tokens[`state_${state}`] = current ? line.mark : null;
    tokens[`title_${state}`] = current && title ? line.titlePrefix + title : null;
  }
  return reportChunked(source, pane, tokens);
}

function clearState(source, pane) {
  const tokens = { sort_key: null, ws_key: null };
  for (const state of STATES) {
    tokens[`logo_${state}`] = null;
    tokens.logo_working_dim = null;
    tokens[`name_${state}`] = null;
    tokens[`state_${state}`] = null;
    tokens[`title_${state}`] = null;
  }
  return reportChunked(source, pane, tokens);
}

// The first pane of each workspace carries the name; the last carries a spacer.
// Herdr's Agents list has no group headers of its own — `agent_panel_sort =
// "spaces"` only orders entries — so a workspace with three tabs otherwise
// renders as three unrelated rows that each repeat the workspace name.
function groupBoundaries(entries) {
  // Walk them in the order Herdr gave us, which is the order the sidebar draws.
  // Sorting by pane id here looked equivalent and was not: ids are handed out
  // as p1..p9 then pA.., while the list follows layout, so a workspace ending
  // pN, pM, pK put the spacer on pN — three rows above the actual end, opening
  // a blank line through the middle of a group.
  const heads = new Set();
  const tails = new Map();
  for (const entry of entries) {
    if (!entry.workspace) continue;
    if (!tails.has(entry.workspace)) heads.add(entry.pane);
    tails.set(entry.workspace, entry.pane);
  }
  return { heads, tails: new Set(tails.values()) };
}

// `ok` reports whether every write landed; a caller that remembers "groups
// are current" off a partial failure leaves a header on the wrong pane until
// the membership happens to change again.
async function writeGroups(source, entries, wsLabels, staleWorkspaces = new Set(), tree = {}) {
  const parentOf = tree.parentOf ?? new Map();
  // Worktrees on the list whose parent checkout is NOT — either it has no agent
  // running or it was never opened as a workspace. There is no pane to hang a
  // parent header on, so there is no tree to draw; the repo name goes inline
  // instead, which keeps the one thing the tree was there to say.
  const orphanRepo = tree.orphanRepo ?? new Map();
  const { heads, tails } = groupBoundaries(entries);
  // Which worktree closes its family, in the order the panel draws: that one
  // gets the corner, its siblings get a tee. Reading it off the display order
  // rather than the topology is what keeps the drawing honest when a sort
  // change moves a sibling.
  const lastChild = new Map();
  const order = [];
  const seen = new Set();
  for (const entry of entries) {
    if (!entry.workspace || seen.has(entry.workspace)) continue;
    seen.add(entry.workspace);
    order.push(entry.workspace);
    const parent = parentOf.get(entry.workspace);
    if (parent) lastChild.set(parent, entry.workspace);
  }
  // A family reads as one block, so the spacer is held back wherever the next
  // group down is a worktree of this one. Left in, it would open a blank line
  // between a checkout and the branch hanging off it and undo the tree.
  const noGap = new Set();
  for (let i = 0; i < order.length - 1; i += 1) {
    if (parentOf.get(order[i + 1]) === order[i]) noGap.add(order[i]);
  }
  const results = await Promise.all(
    entries.map((entry) => {
      const parent = parentOf.get(entry.workspace);
      // The branch is part of the label, not a cell of its own: Herdr gives us
      // one token per row here, and it trims leading whitespace off token
      // values — hence INDENT's zero-width space carrying the offset.
      const mark = config.worktreeMark ? `${config.worktreeMark} ` : '';
      // An orphan gets a SYNTHESISED parent: its repo name goes on a row of its
      // own (`$group_parent`), which is what lets the tree stand up without a
      // parent pane to hang a header on. Squeezing the repo into this row
      // instead was tried first and the sidebar truncated it — and what it cut
      // was the branch name, the session's own identity.
      //
      // No INDENT on an orphan's corner: with the parent row above it, this row
      // is Herdr's own continuation row and arrives indented, exactly where a
      // real child's explicit INDENT puts it.
      const orphan = orphanRepo.has(entry.workspace);
      const branch = parent
        ? `${INDENT}${lastChild.get(parent) === entry.workspace ? '└' : '├'}─ ${mark}`
        : orphan
          ? `└─ ${mark}`
          : '';
      const name = heads.has(entry.pane) ? wsLabels.get(entry.workspace) ?? entry.workspace : null;
      const label = name === null ? null : `${branch}${name}`;
      // A workspace whose every session has gone stale fades its own name
      // too. Otherwise a screen of dormant projects still carries a column of
      // headers at full strength, and the fading underneath reads as damage
      // rather than as the whole thing being asleep.
      const stale = label !== null && staleWorkspaces.has(entry.workspace);
      return herdr.reportMetadataAsync(entry.pane, source, {
        group: stale ? null : label,
        group_stale: stale ? label : null,
        // Only an orphan's head carries it; everywhere else the row collapses,
        // the same way an empty `group` collapses on a group's members.
        group_parent: orphan && name !== null ? orphanRepo.get(entry.workspace) : null,
        // A lone zero-width space: non-empty so Herdr draws the row, zero-width
        // so it reads as blank. It goes on the LAST pane of a group — a spacer
        // above a header would make the header a continuation row, and Herdr
        // indents those away from the left margin.
        gap: config.groupGap && tails.has(entry.pane) && !noGap.has(entry.workspace) ? '​' : null,
      });
    }),
  );
  return { heads, ok: results.every(Boolean) };
}

// Take the group furniture down. In the panel's priority order entries no
// longer sit workspace-contiguous, so a header pinned to "the first pane of
// its workspace" surfaces wherever that pane got sorted — a workspace title
// floating mid-queue over sessions it has nothing to do with.
async function clearGroups(source, entries) {
  const results = await Promise.all(
    entries.map((entry) =>
      herdr.reportMetadataAsync(entry.pane, source, {
        group: null,
        group_parent: null,
        group_stale: null,
        gap: null,
      }),
    ),
  );
  return { heads: new Set(), ok: results.every(Boolean) };
}

// Every pane token the state path owns. `harness_logo` is deliberately not
// here: agent-icons.js writes it and manages its own lifecycle.
const OWNED_TOKENS = [
  'group',
  'group_parent',
  'group_stale',
  'gap',
  'sort_key',
  'ws_key',
  ...STATES.map((s) => `logo_${s}`),
  'logo_working_dim',
  ...STATES.map((s) => `name_${s}`),
  ...STATES.map((s) => `state_${s}`),
  ...STATES.map((s) => `title_${s}`),
];

// Clear our tokens from panes that are not in `live` but still carry them.
// The animator's own cleanup only covers panes it wrote itself — its record is
// in-memory — so a token written by an earlier animator, on a pane whose agent
// exited while no animator ran, outlives every writer. A leftover `group` is a
// duplicate workspace header in the sidebar. Only our source is touched: the
// clear is a no-op for a same-named token some other plugin set.
async function sweepOrphans(source, live, names = OWNED_TOKENS) {
  const jobs = [];
  for (const pane of await herdr.panesAsync()) {
    const id = pane.pane_id;
    if (typeof id !== 'string' || live.has(id)) continue;
    const tokens = pane.tokens && typeof pane.tokens === 'object' ? pane.tokens : {};
    if (!names.some((name) => name in tokens)) continue;
    const clear = {};
    for (const name of names) clear[name] = null;
    jobs.push(reportChunked(source, id, clear)); // 25 owned names, 16 per report
  }
  return (await Promise.all(jobs)).every(Boolean);
}

/* ------------------------------------------------- workspace (Spaces) marks */

// The Spaces list gets the same glyph language as the agent rows: one mark per
// workspace, aggregated over its live agents. Colour is per token name, so
// `working` splits by vendor to keep the brand-colour scheme; every other
// state has one semantic token. A workspace with no live agent shows a
// neutral dot so its name stays aligned with the marked ones.
const SPACE_TOKENS = [
  'space_blocked',
  'space_working_claude',
  'space_working_codex',
  'space_working_grok',
  'space_working_other',
  'space_done',
  'space_idle',
  'space_unknown',
  'space_none',
  // Not states: the vendors alive in the workspace, as logo + name on their
  // own row. One token per vendor, so each keeps its brand colour — Herdr
  // separates the cells with `·`, which on a row of its own reads as a divider
  // rather than clutter. Packing them into a single cell would buy back those
  // few columns at the cost of painting every vendor the same grey.
  'space_logo_claude',
  'space_logo_codex',
  'space_logo_grok',
  'space_logo_other',
  // The workspace name; see writeSpaceState for why it is published at all.
  'space_label',
];

function spaceMark(display) {
  if (display === 'none') return '·';
  return stateGlyph(display) ?? '·';
}

// Which vendor tokens a workspace shows, as logo + name. They live on their
// own row under the workspace name, so there is room for the word — the logo
// alone reads as decoration until you have learned every mark.
//
// Exactly one named vendor → its own brand-coloured token. Anything else →
// everything packed into `multi` as one neutral cell, avoiding the forced `·`
// Herdr puts between cells.
function spaceLogoTokens(agents) {
  const out = {
    space_logo_claude: null,
    space_logo_codex: null,
    space_logo_grok: null,
    space_logo_other: null,
  };
  const seen = new Set();
  const others = [];
  for (const a of agents) {
    if (!a.name || seen.has(a.name)) continue;
    seen.add(a.name);
    const logo = logoFor(a.name);
    const label = logo ? `${logo} ${a.name}` : a.name;
    if (a.name === 'claude' || a.name === 'codex' || a.name === 'grok') {
      out[`space_logo_${a.name}`] = label;
    } else {
      others.push(label);
    }
  }
  if (others.length > 0) out.space_logo_other = others.join(' ');
  return out;
}

function writeSpaceState(source, workspaceId, tokenName, glyph, logoTokens = {}, label = null) {
  const tokens = {};
  for (const name of SPACE_TOKENS) tokens[name] = name === tokenName ? glyph : null;
  Object.assign(tokens, logoTokens);
  // The Spaces panel's name column. Herdr's built-in `workspace` cell always
  // draws the real label and a plugin cannot style it; publishing the label as
  // a token of our own puts the whole row under the managed sidebar block, so
  // it takes the same colour rules as everything else there.
  tokens.space_label = label;
  return herdr.reportWorkspaceMetadataAsync(workspaceId, source, tokens);
}

function clearSpaceState(source, workspaceId) {
  const tokens = {};
  for (const name of SPACE_TOKENS) tokens[name] = null;
  return herdr.reportWorkspaceMetadataAsync(workspaceId, source, tokens);
}

// Everything this plugin painted, on every pane and workspace — the stop path.
// Two families stay: the title tokens, which the sidebar rows show the title
// THROUGH (clearing them blanks every entry, and a stopped plugin should leave
// a plain readable list, not an empty one), and the sort keys, which a view
// may still be ordering by (a frozen order beats a collapsed one). `purge`
// takes those too, plus the vendor logo agent-icons.js writes: the uninstall
// path, where the blocks that render them are about to go.
async function clearAll(source, { purge = false } = {}) {
  const names = purge
    ? [...OWNED_TOKENS, 'harness_logo']
    : OWNED_TOKENS.filter((name) => !name.startsWith('title_') && name !== 'sort_key' && name !== 'ws_key');
  await sweepOrphans(source, new Set(), names);
  await Promise.all(
    (await herdr.workspacesAsync())
      .filter((ws) => typeof ws.workspace_id === 'string')
      .map((ws) => clearSpaceState(source, ws.workspace_id)),
  );
}

module.exports = {
  clearAll,
  STATES,
  baseState,
  SPACE_TOKENS,
  INDENT,
  CHILD_INDENT,
  LOCK,
  STOP,
  pidAlive,
  animatorRunning,
  snapshot,
  labels,
  composeLine,
  writeState,
  clearState,
  spaceMark,
  spaceLogoTokens,
  writeSpaceState,
  clearSpaceState,
  groupBoundaries,
  trimGroupPrefix,
  writeGroups,
  clearGroups,
  sweepOrphans,
  OWNED_TOKENS,
};
