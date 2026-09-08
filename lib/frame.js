'use strict';

// One frame of the sidebar, and the memory that carries between frames.
//
// A frame takes a fresh agent-list snapshot (the only source of truth; events
// are wake hints), decides what every pane should display, and writes the
// tokens that changed. What it remembers from frame to frame — which badge is
// held on which pane, what each pane last showed, when each pane last worked —
// lives on the Frame instance. The daemon (lib/daemon.js) owns the clock and
// the scheduler; this module owns the picture.

const herdr = require('./herdr');
const config = require('./config');
const state = require('./state');
const activity = require('./activity');
const view = require('./view');
const hook = require('./hook');
const { logoFor } = require('./logos');

// One spinner step. The spinner ahead of a working title turns at this rate;
// faster reads as a blur, slower as a stutter. It is also how often the daemon
// wakes while anything works — the price of motion.
// One animation frame. Deliberately equal to the scheduler's POLL_MS
// (lib/daemon.js): our own token writes echo back as pane.updated events, and
// a wake inside the frame floor is refused and re-aimed at lastTick + POLL_MS.
// With any other cadence the animation lands on whichever of the two comes
// later, frame after frame, which is a stutter you can see — 140ms measured
// out as 150, 307, 247, 280.
const SPIN_MS = 150;
// The longest a frame may sleep with nothing scheduled; watchers and events
// are accelerators, this is the guarantee.
const CATCH_ALL_MS = 30000;
const DONE_HOLD_FOREVER = Number.POSITIVE_INFINITY;
// A tick of the frame counter at minute grain: a working pane then costs one
// sort-key write a minute, and equal minutes compare as strings.
const NO_STAMP = '000000000000';

class Frame {
  constructor(source) {
    this.src = source;

    // Badges and holds.
    this.doneUntil = new Map(); // pane -> when its done badge expires (or forever)
    this.previous = new Map(); // pane -> the status it had last frame
    // Panes that asked something and have not gone back to work since, and
    // whether that pane had ever worked when it asked.
    this.blockedSince = new Map();
    this.blockedHeldWork = new Map();

    // Pane -> when it was last seen `working`. Herdr's screen-pattern
    // detection can misread a redraw gap as `idle` for a second or two
    // mid-turn (observed on macOS; Windows paces differently and does not
    // flap). Without a grace window every blip synthesises a done badge, so
    // the sidebar strobes green/spinner. Loaded rather than empty: the stamps
    // outlive any one daemon.
    this.lastWorkingAt = activity.load();
    // Panes whose missing activity stamp was already looked up once. Sessions
    // older than this plugin have no stamp, but the CLI's own session file
    // does remember them — recover it so they shade honestly instead of all
    // reading as plain idle. The lookup walks directories, so once per pane.
    this.recovered = new Set();

    // What each target last showed, so only changes are written.
    this.lastLine = new Map();
    // pane -> the token map last accepted, so a frame can send only the keys
    // that moved.
    this.lastTokens = new Map();
    this.lastSort = new Map();
    this.lastLogo = new Map();
    this.lastSpace = new Map();
    this.members = ''; // fingerprint of the last group layout written

    // Write-failure backoff, per target. A pane whose writes always fail must
    // not keep the daemon awake retrying every wake — that is a self-inflicted
    // busy loop. Failures back off exponentially to a minute.
    this.failedAt = new Map();
  }

  /* ------------------------------------------------------- write backoff */

  writable(key, now) {
    const failure = this.failedAt.get(key);
    return !failure || now >= failure.until;
  }

  settled(key, ok) {
    if (ok) {
      this.failedAt.delete(key);
      return true;
    }
    const failure = this.failedAt.get(key) ?? { count: 0, until: 0 };
    failure.count += 1;
    failure.until = Date.now() + Math.min(60000, 1000 * 2 ** Math.min(failure.count, 6));
    this.failedAt.set(key, failure);
    return false;
  }

  // Persist the activity stamps unconditionally; the daemon calls this on
  // its way out.
  flush() {
    activity.save(this.lastWorkingAt, Date.now(), { force: true });
  }

  /* ------------------------------------------------------------- render */

  // Draw one frame. Returns when the next one is due, or null when the
  // snapshot failed — a failed fetch is not an empty session, and acting on
  // it as one would clear every token and delete every activity stamp.
  async render(now) {
    const entries = await state.snapshot();
    if (entries === null) return null;
    // Labels are always needed: the workspace list drives the Spaces marks.
    const { tabs, workspaces, parents, worktrees } = await state.labels(now);
    // Deadlines this frame discovers; the scheduler sleeps to the earliest.
    const deadlines = [];
    // Every write this frame goes into one parallel batch.
    const jobs = [];

    const keys = this.sortKeys(entries, parents, worktrees);
    const viewMode = view.mode();
    // Which order the panel is actually displaying. The plugin's own views
    // outrank the config toggle (Herdr disables it while they are active);
    // with neither, the config's grouped/priority choice decides.
    const grouped = viewMode === 'grouped' || (viewMode === null && herdr.panelGrouped(now));
    const displayEntries = this.displayOrder(entries, viewMode, keys);
    // Boundaries are needed now — the per-pane loop indents by them — but the
    // group furniture is WRITTEN after that loop, because a header fades with
    // its workspace and whether a workspace is entirely stale is only known
    // once every one of its panes has a display.
    const heads = grouped ? state.groupBoundaries(displayEntries).heads : new Set();
    // The last pane of each split, in the order the panel will draw them, so
    // the corner under it closes the group instead of continuing it.
    const splitLast = new Map();
    if (grouped) {
      for (const entry of displayEntries) {
        if (keys.splitChild(entry)) splitLast.set(entry.tab, entry.pane);
      }
    }

    const live = new Set();
    // workspace -> the display states of its live agents, for the Spaces marks.
    const wsAgents = new Map();
    const spinStep = Math.floor(now / SPIN_MS);

    for (const entry of entries) {
      live.add(entry.pane);
      const display = this.displayFor(entry, now, deadlines);
      if (entry.workspace) {
        if (!wsAgents.has(entry.workspace)) wsAgents.set(entry.workspace, []);
        wsAgents.get(entry.workspace).push({ display, name: entry.name });
      }
      // Herdr indents an entry's continuation rows for us. A head pane's state
      // line is row 2 and arrives indented already; a member's empty header
      // row collapses, so its state line IS row 1 and the indent has to be
      // ours. That asymmetry is why a worktree needs BOTH branches: give its
      // members the deeper indent without also adding one level for its head,
      // and the head sits a level shallower than the sessions it owns. An
      // orphan indents like a real child: its synthesised parent row puts its
      // own rows one level in, same as a child's explicit corner does. With no
      // headers at all (priority order) every line sits at the margin.
      // Depth: a group's first row sits at the margin, everything below it
      // one level in, a worktree's sessions one further. A split does not add
      // a level — its corner is the offset, and a fourth column of indent on
      // rows that are already the deepest in the list buys nothing.
      const depth = grouped ? (heads.has(entry.pane) ? 0 : 1) + (keys.nested(entry.workspace) ? 1 : 0) : 0;
      const indent = state.INDENTS[Math.min(depth, state.INDENTS.length - 1)];
      // The other halves of a split screen hang off the pane they were split
      // from, drawn the way a worktree hangs off its checkout.
      const corner = grouped && keys.splitChild(entry) ? (splitLast.get(entry.tab) === entry.pane ? '└─ ' : '├─ ') : '';
      // The header text this row will sit under, for the prefix trim. Empty
      // in the flat view: nothing is repeated there.
      const header = grouped && config.trimGroupPrefix ? workspaces.get(entry.workspace) ?? '' : '';
      this.paneJobs(entry, display, { tabs, keys, indent, corner, spinStep, header }, now, deadlines, jobs);
    }

    this.clearGone(live, now, jobs);
    this.spaceJobs(wsAgents, workspaces, now, jobs);
    await this.groupJobs(entries, displayEntries, viewMode, grouped, wsAgents, workspaces, keys, now, deadlines);
    await Promise.all(jobs);

    // Sleep to the earliest thing that matters. Failure backoffs are
    // deadlines too — that is what retries them without a busy loop.
    for (const failure of this.failedAt.values()) deadlines.push(failure.until);
    const after = Date.now();
    let sleepUntil = after + CATCH_ALL_MS;
    for (const at of deadlines) {
      if (Number.isFinite(at) && at > after && at < sleepUntil) sleepUntil = at;
    }
    return sleepUntil;
  }

  /* ---------------------------------------------------------- sort keys */

  // Recency keys for the plugin's views, minute-grained. $sort_key ranks a
  // pane, $ws_key ranks its whole workspace (max over members, workspace id
  // as tiebreak so equal minutes never interleave two groups). Published every
  // tick regardless of mode, so flipping views never waits on keys. Stamps
  // written by this very loop land here one tick later — at minute grain that
  // window is invisible.
  sortKeys(entries, parents, worktrees) {
    const minuteKey = (pane) => {
      // The render hook may move a pane in time as well as in look; the views
      // sort on this, so a redacted sidebar keeps a sensible order.
      const at = hook.apply('activity', this.lastWorkingAt.get(pane), pane);
      return typeof at !== 'number' ? null : String(Math.floor(at / 60000)).padStart(12, '0');
    };
    const ownKeys = new Map();
    for (const entry of entries) {
      if (!entry.workspace) continue;
      const key = minuteKey(entry.pane) ?? NO_STAMP;
      const best = ownKeys.get(entry.workspace);
      if (best === undefined || key > best) ownKeys.set(entry.workspace, key);
    }

    // Git worktrees ride with the checkout they were cut from: a family ranks
    // by its most recent member and stays contiguous, parent first. The cost
    // is deliberate — a busy worktree sinks with a dormant parent — because a
    // tree that a sort can pull apart is not a tree.
    //
    // Only when the parent is on the list too. A branch hanging off empty air
    // is worse than no branch, so an orphaned worktree stays top-level here
    // and in writeGroups, which reads the same map.
    const present = new Set(entries.map((entry) => entry.workspace));
    const parentOf = new Map();
    for (const [child, parent] of parents) {
      if (present.has(child) && present.has(parent)) parentOf.set(child, parent);
    }
    // A worktree can be on the list with its parent nowhere on it — the parent
    // has no agent running, or was never opened as a workspace. Herdr's Spaces
    // panel still nests it (it lists workspaces, not agents), so the Agents
    // panel calling it a plain top-level project is the odd one out. No pane
    // means no header to hang a branch off, so writeGroups puts the repo name
    // inline instead of drawing a corner under nothing.
    const orphanRepo = new Map();
    for (const ws of present) {
      const repo = worktrees.get(ws);
      if (repo && !parentOf.has(ws)) orphanRepo.set(ws, repo);
    }
    // Both shapes of worktree sit one level in: the ones hanging off a real
    // parent group, and the ones hanging off a synthesised parent row.
    const nested = (ws) => parentOf.has(ws) || orphanRepo.has(ws);
    const familyOf = (ws) => parentOf.get(ws) ?? ws;

    const familyKeys = new Map();
    for (const [ws, key] of ownKeys) {
      const family = familyOf(ws);
      const best = familyKeys.get(family);
      if (best === undefined || key > best) familyKeys.set(family, key);
    }
    // Sorted descending, so the depth digit runs parent(1) before child(0).
    // It is compared at the same offset for every member of a family because
    // the family id ahead of it is identical across them; the trailing own
    // key then ranks siblings among themselves.
    const wsKeys = new Map();
    for (const [ws, key] of ownKeys) {
      const family = familyOf(ws);
      wsKeys.set(ws, `${familyKeys.get(family)}-${family}-${family === ws ? '1' : '0'}-${key}-${ws}`);
    }
    // Panes that share a tab share a split screen. They rank as one unit —
    // by their most recent member, like a worktree family — and inside the
    // unit the pane the others were split from comes first, then the rest by
    // their own activity. Without this the panel's own sort walks straight
    // through a split, putting an unrelated project between two halves of one
    // screen.
    const tabPanes = new Map();
    for (const entry of entries) {
      if (!entry.tab) continue;
      if (!tabPanes.has(entry.tab)) tabPanes.set(entry.tab, []);
      tabPanes.get(entry.tab).push(entry.pane);
    }
    const tabBest = new Map();
    for (const entry of entries) {
      if (!entry.tab) continue;
      const key = minuteKey(entry.pane) ?? NO_STAMP;
      const best = tabBest.get(entry.tab);
      if (best === undefined || key > best) tabBest.set(entry.tab, key);
    }
    // Herdr lists panes in layout order, so the first one seen for a tab is
    // the one the others were split off from.
    const tabHead = new Map();
    for (const [tab, panes] of tabPanes) tabHead.set(tab, panes[0]);
    const tabKeys = new Map();
    for (const entry of entries) {
      if (!entry.tab) continue;
      const own = minuteKey(entry.pane) ?? NO_STAMP;
      const head = tabHead.get(entry.tab) === entry.pane ? '1' : '0';
      tabKeys.set(entry.pane, `${tabBest.get(entry.tab)}-${entry.tab}-${head}-${own}`);
    }
    // Only a tab holding more than one pane is a split; a lone pane is just a
    // pane and hangs off nothing.
    const split = (entry) => Boolean(entry.tab) && (tabPanes.get(entry.tab)?.length ?? 0) > 1;
    const splitChild = (entry) => split(entry) && tabHead.get(entry.tab) !== entry.pane;

    return { minuteKey, wsKeys, parentOf, orphanRepo, nested, tabKeys, splitChild };
  }

  // The order the panel shows. Group furniture follows the displayed order:
  // for the plugin's grouped view that means predicting the view's sort —
  // same keys, same stable sort, same missing-last rule — and pinning headers
  // to ITS first and last panes, not the agent list's.
  displayOrder(entries, viewMode, { wsKeys, minuteKey, tabKeys }) {
    if (viewMode !== 'grouped') return entries;
    return [...entries].sort((a, b) => {
      const wa = wsKeys.get(a.workspace) ?? '';
      const wb = wsKeys.get(b.workspace) ?? '';
      if (wa !== wb) return wa > wb ? -1 : 1;
      const ta = tabKeys.get(a.pane) ?? '';
      const tb = tabKeys.get(b.pane) ?? '';
      if (ta !== tb) return ta > tb ? -1 : 1;
      const ka = minuteKey(a.pane);
      const kb = minuteKey(b.pane);
      if (ka === kb) return 0;
      if (ka === null) return 1;
      if (kb === null) return -1;
      return ka > kb ? -1 : 1;
    });
  }

  /* ------------------------------------------------------- pane display */

  // What one pane shows this frame, given what Herdr reports and what this
  // instance remembers. Pushes the moments at which that answer would change
  // onto `deadlines`.
  displayFor(entry, now, deadlines) {
    const pane = entry.pane;

    if (!this.lastWorkingAt.has(pane) && !this.recovered.has(pane)) {
      this.recovered.add(pane);
      const at = activity.recover(entry.name, entry.session);
      if (at) {
        this.lastWorkingAt.set(pane, at);
        activity.save(this.lastWorkingAt, now);
      }
    }

    if (entry.status === 'working') {
      this.lastWorkingAt.set(pane, now);
      activity.save(this.lastWorkingAt, now);
    }

    // Recently working and now idle/done? Treat it as still working until
    // the grace window has fully elapsed — a genuine turn end survives it, a
    // detection blip does not. `blocked` bypasses it: that state is the agent
    // asking a question and must show immediately.
    const sinceWorking = now - (this.lastWorkingAt.get(pane) ?? -Infinity);
    const inGrace =
      (entry.status === 'idle' || entry.status === 'done') &&
      this.previous.has(pane) &&
      sinceWorking < config.idleGraceMs;
    const status = inGrace ? 'working' : entry.status;

    // working -> idle/done means a turn just finished.
    if (this.previous.get(pane) === 'working' && (status === 'idle' || status === 'done')) {
      this.doneUntil.set(pane, config.doneHoldUntilSeen ? DONE_HOLD_FOREVER : now + config.doneHoldSeconds * 1000);
    }
    this.previous.set(pane, status);

    // A question outlives the recognition that spotted it, and may outlive
    // this process — the published token is the record here just as it is
    // for the done badge. A question that arrives before the agent has ever
    // worked is a startup prompt — the trust dialog on a new directory.
    // Answering one of those drops straight back to idle without a turn, so
    // waiting for `working` would pin the mark until the agent happens to do
    // something else. Questions asked mid-work do reach `working` when
    // answered, and those are the ones worth holding: they are also the ones
    // you glance at and come back to.
    if (config.blockedHoldUntilAnswered) {
      if (status === 'blocked') {
        if (!this.blockedSince.has(pane)) {
          this.blockedSince.set(pane, now);
          this.blockedHeldWork.set(pane, this.lastWorkingAt.has(pane));
        }
      } else if (status === 'working' || this.blockedHeldWork.get(pane) === false) {
        this.blockedSince.delete(pane);
        this.blockedHeldWork.delete(pane);
      } else if (!this.blockedSince.has(pane) && entry.showing === 'blocked') {
        // Outlived the last daemon. Whether it had worked is not knowable from
        // a published token, so assume the holding kind — a mark that lingers
        // beats a reminder that vanished.
        this.blockedSince.set(pane, now);
        this.blockedHeldWork.set(pane, true);
      }
    }

    // Re-adopt a badge this process never set: it outlived the last daemon.
    if (config.doneHoldUntilSeen && !this.doneUntil.has(pane) && entry.showing === 'done' && entry.status !== 'working') {
      this.doneUntil.set(pane, DONE_HOLD_FOREVER);
    }

    // Looking at the pane is the acknowledgement.
    if (entry.focused) this.doneUntil.delete(pane);

    let display;
    if (status === 'working') {
      this.doneUntil.delete(pane);
      this.blockedSince.delete(pane);
      this.blockedHeldWork.delete(pane);
      display = 'working';
    } else if (this.blockedSince.has(pane)) {
      // Answering is what clears it, and answering makes the agent work.
      this.doneUntil.delete(pane);
      display = 'blocked';
    } else if (now < (this.doneUntil.get(pane) ?? 0)) {
      display = 'done';
    } else {
      this.doneUntil.delete(pane);
      // Split idle by how long ago this pane last worked. Nothing else in the
      // sidebar distinguishes "you stepped away mid-thought" from "abandoned
      // on Tuesday", and with this many sessions that is the distinction that
      // actually matters.
      display = status === 'idle' ? activity.freshness(this.lastWorkingAt.get(pane), config, now) : status;
      // Tier crossings are deadlines: an idle pane turns fresh->idle->stale at
      // exact moments, and a sleeping daemon has to wake for them.
      if (status === 'idle') {
        const at = this.lastWorkingAt.get(pane);
        if (typeof at === 'number') {
          for (const crossing of [at + config.activityFreshMs, at + config.activityStaleMs]) {
            if (crossing > now) deadlines.push(crossing);
          }
        }
      }
    }
    if (!state.STATES.includes(display)) display = 'unknown';
    // Last word to the render hook, after every real computation; without a
    // hook this is the identity.
    const shown = hook.apply('state', display, pane);
    return state.STATES.includes(shown) ? shown : display;
  }

  /* --------------------------------------------------------- pane writes */

  // The three token families a pane carries — vendor logo, state line, sort
  // keys — each written only when it changed since the last successful write.
  paneJobs(entry, display, { tabs, keys, indent, corner = '', spinStep, header = '' }, now, deadlines, jobs) {
    const pane = entry.pane;
    const src = this.src;

    // The vendor logo rides along: this loop already knows the agent.
    const logo = logoFor(entry.name) ?? null;
    if (this.lastLogo.get(pane) !== logo && this.writable(`logo:${pane}`, now)) {
      jobs.push(
        herdr.reportMetadataAsync(pane, src, { harness_logo: logo }).then((ok) => {
          if (this.settled(`logo:${pane}`, ok)) this.lastLogo.set(pane, logo);
        }),
      );
    }

    const title = state.trimGroupPrefix(entry.title, header);
    const line = state.composeLine(entry, display, config.showTab ? tabs.get(entry.tab) ?? '' : '', indent, spinStep, corner);
    // A state with no line still has to clear the previous one: merely
    // skipping the write leaves the old token up — or, on a pane that had
    // none, no state row at all, which renders its bare title at the margin
    // looking like a group header.
    const key = line ? `${display}:${line.mark}:${line.split}:${line.logo}:${line.titlePrefix}:${title}` : '';
    if (this.lastLine.get(pane) !== key && this.writable(`line:${pane}`, now)) {
      // Send the difference, not the whole set: see state.stateTokens.
      const tokens = line ? state.stateTokens(display, line, title) : null;
      // The first write to a pane in this daemon's life sends the whole set,
      // nulls included: the pane may still carry names an earlier daemon left
      // on it — a title under a state it is no longer in, say — and a delta
      // against "nothing cached" reads those as already absent and never
      // clears them.
      const delta = tokens
        ? this.lastTokens.has(pane)
          ? state.tokenDelta(tokens, this.lastTokens.get(pane))
          : tokens
        : null;
      const write = tokens
        ? Object.keys(delta).length
          ? state.writeTokens(src, pane, delta)
          : Promise.resolve(true)
        : state.clearState(src, pane);
      jobs.push(
        write.then((ok) => {
          if (ok) {
            if (tokens) this.lastTokens.set(pane, tokens);
            else this.lastTokens.delete(pane);
          }
          if (this.settled(`line:${pane}`, ok)) this.lastLine.set(pane, key);
        }),
      );
    }

    // The views sort on these: last-active, minute-grained so a working pane
    // costs one write a minute, zero-padded so the string sort is the numeric
    // sort. Panes with no stamp publish no $sort_key and sort after every
    // stamped one — Herdr puts missing values last.
    const sortKey = keys.minuteKey(pane);
    const wsKey = entry.workspace ? keys.wsKeys.get(entry.workspace) ?? null : null;
    const tabKey = keys.tabKeys.get(pane) ?? null;
    const sortPair = `${sortKey}|${wsKey}`;
    if (this.lastSort.get(pane) !== sortPair && this.writable(`sort:${pane}`, now)) {
      jobs.push(
        herdr.reportMetadataAsync(pane, src, { sort_key: sortKey, ws_key: wsKey, tab_key: tabKey }).then((ok) => {
          if (this.settled(`sort:${pane}`, ok)) this.lastSort.set(pane, sortPair);
        }),
      );
    }

    if (!line) return;

    // A working spinner has to be repainted at the next step; a timed badge
    // at its expiry. Until-seen badges are static — an event wakes us to
    // clear those.
    const hold = this.doneUntil.get(pane);
    if (display === 'working') deadlines.push((Math.floor(now / SPIN_MS) + 1) * SPIN_MS);
    else if (hold !== undefined && hold !== DONE_HOLD_FOREVER) deadlines.push(hold);
  }

  // Panes that left the agent list since we last painted them.
  clearGone(live, now, jobs) {
    for (const pane of [...this.lastLine.keys()]) {
      if (live.has(pane)) continue;
      if (!this.writable(`clear:${pane}`, now)) continue;
      jobs.push(
        state.clearState(this.src, pane).then((ok) => {
          if (ok) this.lastTokens.delete(pane);
          if (!this.settled(`clear:${pane}`, ok)) return; // retry after backoff
          this.lastLine.delete(pane);
          this.lastSort.delete(pane);
          this.lastLogo.delete(pane);
          this.previous.delete(pane);
          this.doneUntil.delete(pane);
          this.lastWorkingAt.delete(pane);
          this.blockedSince.delete(pane);
          this.blockedHeldWork.delete(pane);
        }),
      );
    }
  }

  /* -------------------------------------------------------- Spaces marks */

  // One aggregated glyph per workspace, published as a workspace token.
  // Priority is urgency: a question beats activity beats an unseen result
  // beats parked. The per-pane displays already carry the idle grace and the
  // held done badge, so the aggregate inherits both for free.
  spaceJobs(wsAgents, workspaces, now, jobs) {
    const src = this.src;
    const wsIds = new Set(workspaces.keys());
    for (const ws of wsAgents.keys()) wsIds.add(ws);
    for (const ws of wsIds) {
      const agents = wsAgents.get(ws) ?? [];
      let chosen = 'none';
      let vendor = '';
      for (const p of ['blocked', 'working', 'done', 'idle', 'unknown']) {
        const hit = agents.find((a) => a.display === p);
        if (hit) {
          chosen = p;
          vendor = hit.name;
          break;
        }
      }
      const token =
        chosen === 'working'
          ? `space_working_${['claude', 'codex', 'grok'].includes(vendor) ? vendor : 'other'}`
          : `space_${chosen}`;
      const glyph = state.spaceMark(chosen);
      const logos = state.spaceLogoTokens(agents);
      const label = workspaces.get(ws) ?? ws;
      const key = `${token}:${glyph}:${Object.values(logos).join(',')}:${label}`;
      if (this.lastSpace.get(ws) !== key && this.writable(`space:${ws}`, now)) {
        jobs.push(
          state.writeSpaceState(src, ws, token, glyph, logos, label).then((ok) => {
            if (this.settled(`space:${ws}`, ok)) this.lastSpace.set(ws, key);
          }),
        );
      }
    }
    for (const ws of [...this.lastSpace.keys()]) {
      if (wsIds.has(ws)) continue;
      if (!this.writable(`space:${ws}`, now)) continue;
      jobs.push(
        state.clearSpaceState(src, ws).then((ok) => {
          if (this.settled(`space:${ws}`, ok)) this.lastSpace.delete(ws);
        }),
      );
    }
  }

  /* ------------------------------------------------------ group furniture */

  // Headers, indents and spacers, rewritten only when the layout changed. A
  // workspace counts as stale when every session in it is — that is what lets
  // a whole dormant project recede, header included, instead of leaving a row
  // of bright names over faded contents.
  async groupJobs(entries, displayEntries, viewMode, grouped, wsAgents, workspaces, keys, now, deadlines) {
    const staleWorkspaces = new Set();
    for (const [ws, agents] of wsAgents) {
      if (agents.length > 0 && agents.every((a) => a.display === 'idle_stale')) staleWorkspaces.add(ws);
    }
    // Headers move when the panes, their displayed order, the mode, or a
    // workspace's collective staleness changes. Topology too: opening or
    // closing a worktree changes the branches drawn and which group holds
    // back its spacer, with the pane list untouched.
    const fingerprint =
      `${viewMode ?? (grouped ? 'grouped' : 'flat')}:` +
      `${[...staleWorkspaces].sort().join('+')}:` +
      `${[...keys.parentOf].map(([child, parent]) => `${child}<${parent}`).sort().join('+')}:` +
      `${[...keys.orphanRepo].map(([ws, repo]) => `${ws}@${repo}`).sort().join('+')}:` +
      displayEntries.map((e) => `${e.workspace}/${e.pane}`).join(',');
    if (fingerprint === this.members) return;

    let ok = true;
    if (state.INDENT) {
      const wrote = grouped
        ? await state.writeGroups(this.src, displayEntries, workspaces, staleWorkspaces, {
            parentOf: keys.parentOf,
            orphanRepo: keys.orphanRepo,
          })
        : await state.clearGroups(this.src, entries);
      ok = wrote.ok;
    }
    // Membership changing is exactly when a pane may just have dropped out of
    // the agent list with our tokens still on it.
    ok = (await state.sweepOrphans(this.src, new Set(entries.map((e) => e.pane)))) && ok;
    // Remember this layout only if every write landed; a failed one left a
    // header or spacer on the wrong pane, and only a retry fixes that.
    if (ok) this.members = fingerprint;
    else deadlines.push(now + 2000);
  }
}

module.exports = { Frame, SPIN_MS };
