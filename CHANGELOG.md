# Changelog

## 1.4.1 — 2026-10-04

- **Herdr reads your config again.** 1.3.21 gave three more vendors a
  working mark of their own in the Spaces column, which took that row to
  eighteen tokens. Herdr refuses a sidebar row over sixteen, and with it the
  whole `config.toml` — so on any machine where the plugin rewrote its
  sidebar block, Herdr ran on its defaults and every setting of your own was
  ignored (`herdr config check` reports `sidebar rows may contain at most 16
  tokens`). Nine vendors now keep a working mark of their own and the rest
  share the generic one; every vendor's logo keeps its colour. **Nothing to
  do by hand**: the daemon recognises the broken block on start, rewrites it
  and reloads Herdr.

  Two things let it through, and both are closed: the row-limit guard only
  counted the Agents rows, and the switch that follows your desktop's light
  and dark wrote the block without checking it — every write now goes through
  `herdr config check` and is rolled back if Herdr cannot parse it.

## 1.4.0 — 2026-10-03

- **A Kilo Code session that predates the daemon gets its freshness back.**
  The idle shades — just stopped, idle, stale — come from when a session
  last worked, and a pane that was already open when the daemon started has
  no stamp of its own. Claude and Codex panes recover one from their own
  transcripts; Kilo keeps a SQLite store instead, so its session's own
  `time_updated` row is read now. Read-only and only that row, on a Node
  whose built-in `node:sqlite` truly opens read-only (22.12+, 23.2+ on the 23
  line); on anything older the pane reads as plain idle, as before.
  [#34](https://github.com/hhdebb/herdr-radar/pull/34) by @christophkroeppl.

## 1.3.21 — 2026-10-03

- **Three more agents wear their own mark.** Kimchi (CAST AI's coding
  agent) gets the chili from its site, in its published orange
  ([#37](https://github.com/hhdebb/herdr-radar/pull/37) by @testy-cool).
  Muse Code publishes no mark of its own and its site signs it with Meta's,
  so that is the mark it wears here, in Meta blue
  ([#38](https://github.com/hhdebb/herdr-radar/pull/38) by @stevmills).
  Crush reports itself to Herdr as `crush` and now wears the pixel heart it
  draws in its own source, in the heart's cheek pink
  ([#36](https://github.com/hhdebb/herdr-radar/issues/36), asked for by
  @unbegrenzt). The icon range is `U+E1A0–U+E1BA` now; a terminal mapped by
  hand needs the new end.

## 1.3.20 — 2026-09-28

- **`row_label` says what names a row.** `show_tab = true` put the tab's
  name in front of the session title, and a tab named after the session it
  runs — a common habit past a few tabs — read the same thing twice, the
  second copy off the edge. `row_label` replaces it: `title` (the default)
  is the session's own title, `tab` is the tab's name instead, `both` is
  what `show_tab = true` did — and still reads as, without `row_label`. A
  tab that was never named carries Herdr's number, so in `tab` mode it keeps
  the title rather than reading as `1`.
  [#26](https://github.com/hhdebb/herdr-radar/pull/26) by @sleistner.

## 1.3.19 — 2026-09-28

- **A group's spacer no longer lands mid-group.** A pane's sort keys were
  rewritten only when its own two keys changed, but `tab_key` follows the
  busiest pane of the tab and can move on its own — Herdr then sorted by
  the stale one while the spacer was placed from the fresh one, and in a
  workspace with two tabs the blank row could open between them. All three
  keys are part of the rewrite check now.
  [#27](https://github.com/hhdebb/herdr-radar/pull/27) by @sleistner.

- **A symlinked config keeps its link.** A `config.toml` linked in from a
  dotfiles repository was replaced by a plain file the first time the
  settings popup saved or `configure` rewrote the managed blocks, and every
  change after that stayed on the machine. Writes go through the link to
  its target now. [#28](https://github.com/hhdebb/herdr-radar/pull/28) by
  @sleistner.

- **The settings popup fits the terminal.** It takes 90% of the terminal's
  height instead of a fixed 26 rows, the list scrolls with the cursor when
  it is taller than the room, and the name column fits the longest name so
  every value starts in one column.
  [#29](https://github.com/hhdebb/herdr-radar/pull/29) by @sleistner.

## 1.3.18 — 2026-09-27

- **A split pane draws as a plain row; the corner is a setting.** The other
  panes of a split screen used to hang off the first with a `├─` corner, the
  way a worktree hangs off its checkout. A split is two peers sharing one
  tab, and the corner read as a hierarchy that is not there — and cost the
  row two columns plus Herdr's separator, so a title that fit on a plain row
  truncated on its split half. The corner is off now; the panes of a tab
  still sit together. `split_corner = true`, in `config.toml` or the settings
  popup, brings the tree back.

  From [#17](https://github.com/hhdebb/herdr-radar/pull/17) by @sfroment.

## 1.3.17 — 2026-09-27

- **A second workspace on the same checkout is a peer, not a worktree.** Open
  one repository in two workspaces — a feature and a quick review, both on
  the main checkout — and the second one hung under the first with a branch
  corner, next to the real worktrees, and inherited its place in the
  activity order. Only a linked worktree hangs under its checkout now; a
  second workspace on the same folder stays top-level beside the first.

  Fixed in [#24](https://github.com/hhdebb/herdr-radar/pull/24) by
  @sleistner.

## 1.3.16 — 2026-09-27

- **`herdr plugin install` works on Windows.** The install's build hook
  runs inside Herdr's temporary checkout, which Herdr renames into place
  once the hook is done — and the hook used to start the daemon from there.
  A daemon started that way inherited the temporary checkout as its working
  directory, and on Windows a directory that some process is sitting in
  cannot be renamed, so every install on Windows ended with `os error 32`,
  no plugin registered and empty `.tmp-install-*` folders left behind. The
  build hook now only writes the managed blocks and installs the font; the
  daemon starts from the startup hooks and the `state-start` action once the
  plugin is where it will stay, which is also where it should have been
  running from all along.

  Reported in [#23](https://github.com/hhdebb/herdr-radar/issues/23) by
  @tylyp, confirmed by @Pool1541.

## 1.3.15 — 2026-09-25

- **A table you already have keeps only its block out.** The plugin writes
  `[theme.custom]` and the `[ui.sidebar.*]` tables itself, and TOML allows a
  table once. A copy in your own config used to refuse the whole install —
  and was only noticed in its header form: `custom.name = …` under `[theme]`,
  or an inline table, slipped past, the block was appended on top, and Herdr
  fell back to defaults for the entire file, taking every plugin with it.
  Every form is seen now, and the block that would collide stays out while
  the others install: with your own sidebar tables the Agents panel stays
  Herdr's, with your own theme table your colours stay. The note says which
  block and why. The check reads the file as TOML, not as lines; if a
  config it misjudges ever turns up, the effect is a skipped block and a
  note, never a broken file.

- **The reason reaches the screen.** Herdr shows a failed action as
  `failed (exit 1)` and files the output in the plugin log, which nobody
  installing for the first time knows to read. A skipped block or a refusal
  is now posted as a Herdr notification as well.

- **A write is checked before it is kept.** Every change to `config.toml` is
  followed by `herdr config check`; on a parse error the file is restored
  from the backup and the parser's message becomes the note. A warning, such
  as an unknown key, is not a parse error and does not block.

  Reported in [#22](https://github.com/hhdebb/herdr-radar/issues/22) by
  @skylarmb.

## 1.3.14 — 2026-09-25

- **A closed pane or workspace is cleared once, then forgotten.** Herdr answers
  a write to a target that no longer exists with a not-found error, and the
  daemon counted that as a failed write. Failed writes retry under a backoff
  capped at a minute that never gives up, so every pane and workspace that
  ever closed was cleared again once a minute for the daemon's whole life:
  most of its calls ended in errors, the server log filled with them, and
  each pending retry kept waking the loop. Not-found now counts as done, and
  a closed pane also drops any backoff left from a repaint that failed before
  it closed.

  Reported in [#21](https://github.com/hhdebb/herdr-radar/issues/21) by
  @IGUNUBLUE.

- **Behaviour is tested with `node --test`.** `npm run check` keeps the
  invariants; the behaviour cases moved into `test/` as a proper test suite,
  run by `npm test` and in CI. Nothing changes at runtime.

## 1.3.13 — 2026-09-25

- **The daemon starts when a stale pid file names someone else.** Liveness was
  `kill(pid, 0)` on `animator.pid`, which only asks whether *some* process has
  that number. After a reboot — or just a Herdr restart — the number can belong
  to a browser or an editor helper, and the startup hook then declined to start
  a daemon: a blank sidebar, the action reporting success, nothing in any log.
  The launcher now asks the daemon's control endpoint instead, which is named
  per user and per plugin, so only this daemon can answer it.

  Reported in [#19](https://github.com/hhdebb/herdr-radar/issues/19) by
  @ashnegiii, confirmed by @IGUNUBLUE.

- **A daemon that stops drawing is replaced.** A daemon can answer its endpoint
  and still produce no frames, and it holds the endpoint, so nothing could take
  its place. It now reports two ages: how long since its timer last fired, and
  how long the frame in flight has been running. The launcher treats a timer
  silent for thirty seconds, or a frame running for five minutes, as a stall
  — kept apart so a frame merely waiting on a slow Herdr is never mistaken for
  one — confirms it a few seconds later, ends it, and starts a fresh daemon,
  noting why at the top of `animator.err`.

  The cause behind the report: the frame floor compared the wall clock with
  the time of the last frame, so a clock stepped *backwards* — NTP correcting a
  fast RTC at boot, exactly when the daemon starts — made every wake look too
  soon and froze the panel for as long as the step. Scheduling now runs on a
  monotonic clock. Reported in
  [#18](https://github.com/hhdebb/herdr-radar/issues/18) by @travisjeffery.

- **A request no longer vanishes when the daemon hangs up mid-exit.** A client
  that pinged a daemon in the instant it exited could be left waiting on a
  reply that would never come, and exit silently. It now gets a clean "nobody
  answered".

## 1.3.12 — 2026-09-21

- **A group header follows its workspace's name.** The sidebar rewrites the
  group furniture only when a fingerprint of the layout changes, and that
  fingerprint left out the one thing the header is made of — the workspace
  label. A workspace first drawn while its label was still being fetched wore
  its bare id, and nothing afterwards moved the fingerprint: the heartbeat and
  the catch-all deadline both just draw again from the same remembered layout.
  Renaming a workspace now moves its header within one label refresh.

  From [#13](https://github.com/hhdebb/herdr-radar/pull/13), by @bubabi.

- **A failed label read no longer blanks every header.** The read cannot report
  failure — it answers an empty list for a timed-out call and for a session
  with nothing open alike — so a single failed refresh replaced every cached
  label with nothing, drew every group header as a bare id, and drew them all
  again on the next good read. With the fingerprint above now sensitive to
  labels, a flapping socket would have rewritten the whole panel on each swing.
  The labels are kept, and a failed read waits out the same interval a good one
  does rather than retrying on every frame.

## 1.3.11 — 2026-09-21

- **`omp` is Oh My Pi, not OhMyPosh.** The mark was always Oh My Pi's — the
  third-party notices have credited `can1357/oh-my-pi` since the first release
  — but the display name beside it, and the vendor table in all three READMEs,
  named a prompt theme engine instead. Herdr's own detection puts `omp` next to
  `pi` and gives it a `--resume` taking a session id; a prompt engine has no
  sessions to resume.

  From [#12](https://github.com/hhdebb/herdr-radar/pull/12), by @bubabi.

- **Three vendors had their marks drawn and never credited.** `amp`, `devin`
  and `qodercli` have shipped since 1.3.5 with no line in
  `THIRD_PARTY_NOTICES.md`. They have one now. The same file said the patched
  font carries 29 icon glyphs where it carries 30.

  Adding a vendor touches six places — a codepoint, a source mark, a built
  mark, three tables in `lib/logos.js`, and the notices — and nothing compared
  them, which is how both of these got through and how the wrong display name
  above sat beside the right attribution for eleven releases. `npm run check`
  now requires all six to name the same set of vendors, and the notices to
  state the count the font is actually built from. It cannot check that the
  wording is right; that is the one place a person writes prose.

- **Counts and a path in the docs were stale too.** All three READMEs said
  twenty-three vendors four releases after the 24th arrived, and the notices
  pointed at a directory this repository has never had. Both are checked now.

## 1.3.10 — 2026-09-21

- **An agent that sets no terminal title keeps its name.** The row is
  `logo · title`, and when the title says nothing the vendor's name takes its
  place — but the test for "says nothing" asked only whether the title was
  *only a location*, and an absent title is not a location. Agents that never
  set an OSC title (Antigravity, codex) drew a logo with nothing beside it, as
  did any pane before its shell reported one.

  The same hole swallowed a title that was nothing but the attention bracket:
  it arrives non-empty and is emptied here by the strip that removes it.

  Outer whitespace on a real title is now normalised away, which it was not
  before. The row's indent comes from its own prefix, so that padding was
  either invisible or a stray gap inside the cell.

  From [#10](https://github.com/hhdebb/herdr-radar/pull/10), by @CLOUDWERX-DEV.

## 1.3.9 — 2026-09-20

- **A workspace with a parked agent no longer reads as empty.** The Spaces
  column picks one mark per workspace from its live agents, but it chose from a
  list of five states while a pane's display carries one of seven: the list was
  written before idle was split by freshness, and the two tiers it missed
  matched nothing. A workspace whose agents were all `idle_fresh` or all
  `idle_stale` fell through to `none` and drew the dot that means no agent is
  there at all.

  Those two tiers are most of idle's life — `idle_fresh` is the first fifteen
  minutes after every turn, `idle_stale` everything past two hours — so the mark
  was wrong far more often than it was right, and the Agents panel and the
  Spaces column disagreed about the same pane. It shows up most sharply right
  after an agent finishes: the held `done` badge expires into `idle_fresh` and
  the workspace appears to lose its agent.

  The three tiers now share the one idle cell they already share a glyph with.
  `tools/check.js` holds the pieces together: every state reaches the priority
  list, every token that list can yield exists, and every published token has a
  cell to draw in — a token with no cell never draws, and one outside the
  published set clears every state mark at once rather than mis-drawing a cell.

  From [#11](https://github.com/hhdebb/herdr-radar/issues/11), by @genexk.

- **The checks now have to prove they can fail.** `npm run prove` puts each
  known-bad shape back into the source it came from, runs the invariants, and
  restores the file: twenty-one shapes, every one a regression that was really
  shipped or really proposed in review. It exists because one invariant here
  could only ever pass — it carried a literal control character where an escape
  was meant, matched nothing, and printed as though it were fine. CI runs it.

## 1.3.8 — 2026-09-19

- **The Ghostty codepoint map now matches.** Since v1.0.0 the installer wrote
  `font-codepoint-map = U+E1A0-U+E1B7="Herdr Agent Icons Max"`, and Ghostty
  reads that value literally: the quotes were part of the family name it looked
  for, no such family exists, and the two ranges fell through to whatever else
  claims the Private Use Area — on most systems a CJK font. Every obvious check
  passed while it was broken: the font installed, `+list-fonts` found it,
  `+show-config` printed the map. Only `ghostty +show-face` says whether a map
  resolved, and the README now says so.

  The map is written unquoted, and `tools/check.js` refuses any terminal block
  that quotes the family again.

  **If you installed on v1.3.7 or earlier, run the install action once more** —
  the block is replaced wholesale, nothing to clean up by hand.

  From [#8](https://github.com/hhdebb/herdr-radar/pull/8), by @lunetics.

- **The hand-mapping ranges in the READMEs were four codepoints short.** All
  three said `U+E1A0–U+E1B3`; the 24th vendor moved the end to E1B7 in 1.3.6
  and the prose never followed. The Chinese README had also drifted to `E1D1`
  on the second range. Corrected, and `tools/check.js` now derives the ranges
  from `lib/font.js` and fails on any README that prints a different one.

- **CI.** Every push and pull request now runs the invariants, Prettier, and a
  font-staleness check on GitHub Actions — the last three pull requests all
  arrived with "no automated check could be run against this repository".
  `fonttools` is pinned rather than floored: a rebuild is only byte-for-byte
  within one version, and the staleness check depends on that.

## 1.3.7 — 2026-09-19

- **Workspace indices can follow the panel's order.** Radar sorts the Agents
  panel by activity, but the indexed workspace jump walks Herdr's own workspace
  list — so the row you see first and the workspace the key reaches are not the
  same one. A plugin cannot rebind that key, so with `reorder_workspaces = true`
  the workspaces themselves move instead, and the Spaces list reads in the same
  order as the panel.

  Worktree families move whole, parent first; workspaces with nothing running
  keep their relative order at the end. It stops while the panel is handed back
  to Herdr's own order, because reordering there would recreate the same
  disagreement the other way round.

  Off by default. It changes Herdr's *global* Spaces order, which every
  connected client sees, and the order then moves as you work — the number that
  reaches a project today is not the one that reaches it tomorrow.

  Note that Herdr leaves `switch_workspace` **unbound by default** (`switch_tab`
  ships as `prefix+1..9`; the workspace jump does not ship at all), so the keys
  do nothing until you bind them. The README shows the binding.

  From [#6](https://github.com/hhdebb/herdr-radar/pull/6), by @erkangurel.

## 1.3.6 — 2026-09-19

- **A mark for GLM, and a way for a pane to say what it is.** A GLM session runs
  the stock `claude` binary against an Anthropic-compatible endpoint, so Herdr
  detects `claude` — correctly, and permanently: identity comes from the process
  name matched against a set compiled into Herdr, and the wrapper execs the same
  binary everyone else does. Detection cannot see through that and neither can
  this plugin; what a pane is doing is known only to whoever started it.

  So the pane says so. Herdr carries a display-only `display_agent` field for
  exactly this, and one line before the `exec` fills it in:

  ```sh
  herdr pane report-metadata "$HERDR_PANE_ID" --source user:cglm --display-agent glm
  ```

  The sidebar now prefers that value — but only when it names a vendor this
  plugin can draw. The field is free text (Herdr's own example is `Claude: auth`)
  while every consumer of the name treats it as a vendor key, so anything else
  falls through and the row keeps the mark detection gave it. This is not a GLM
  feature: any wrapper around a known binary can use it, and the plugin keeps no
  detection rules of its own.

  The mark is Z.ai's, at E1B7, solved to the same 920 longest edge as every other
  vendor and monochrome as published, so it takes the row's ink.

  Reported in [#3](https://github.com/hhdebb/herdr-radar/issues/3) by
  @deliriumlabs.

- **The font's codepoint map no longer has to be remembered.** The installer
  tells the terminal which codepoints to take from our font, and that list was
  written down by hand. The 24th vendor landed at E1B7, one past the end: the
  terminal would have kept looking in its own font and drawn nothing, while
  `install-font` reported success. The vendor range is derived from the glyph
  table now, and `npm run check` reads `tools/codepoints.toml` back and fails if
  either range stops covering what the font defines.

## 1.3.5 — 2026-09-17

- **The stale tier no longer fades itself out of existence.** Five cells asked
  for the terminal's `dim` on top of an already-faded ink, and `dim` is a
  switch rather than a value: it says "draw this faintly" and every terminal
  answers differently — a third of the way to the background in one, half in
  another, nothing in a third. An ink faint enough to survive the deepest of
  those answers is too faint to read before any of them.

  The dark stale ink was `#585a64`, which is 2.6:1 on a dark panel and caps at
  3.06:1 against *any* background, so it was under the floor before a terminal
  touched it. Rendered it measured 1.8:1 on one machine and 1.5:1 on another:
  the row was present and drawn, and could not be read.

  `dim` is gone from those cells and the fade is in the palette, where it can
  be measured. The dark second-rank inks move up, `idle` and `subtle` split per
  appearance — one value cannot be second-rank on a light panel and clear a
  floor on a dark one — and the light stale ink moves too, at 2.2:1 it was
  under the floor even with `dim` gone.

  `npm run check` now scores every text ink in the sidebar block against a
  reference panel per appearance and rejects `dim` outright. Vendor marks are
  exempt: a logo is a shape, and the floor is about text that cannot be read.

  Reported in [#5](https://github.com/hhdebb/herdr-radar/issues/5) by
  @rakesh-investmates, with measurements and a patch.

## 1.3.4 — 2026-09-16

- **The Ghostty block no longer replaces your terminal font.** It wrote
  `font-family = "Herdr Agent Icons Max"` alongside the codepoint maps, and in
  Ghostty `font-family` is not "also load this" — it is the *primary* font. Ours
  holds icons and nothing else, so every ordinary character went looking in a
  font that cannot draw it and the terminal fell back to something you never
  chose: not the icons, every line of text. The `font-codepoint-map` lines
  redirect our two ranges whatever the primary font is, which is all this ever
  needed, so the `font-family` line is gone. `npm run check` now fails if
  anything we write into a terminal config claims that terminal's primary font.

  If you installed an earlier version, the line is still in your config. Re-run
  the plugin's install-font action — the managed block is replaced wholesale, so
  one run clears it. kitty was never affected; its `symbol_map` lines only ever
  mapped the ranges.

  Reported in [#4](https://github.com/hhdebb/herdr-radar/issues/4) by
  @adamflitney.

## 1.3.3 — 2026-09-16

- The README banner is rebuilt. Both screenshots are now the ground rather than
  objects sitting on it: faded down and masked at the edges, so no rectangle
  survives to read as a screenshot pasted onto the page. Light on the left, dark
  on the right, which is the theme story without a caption. All 23 vendor marks
  orbit the wordmark on three rings.

- The sidebar figure is both themes instead of one. It was a single portrait
  capture of the dark theme, about 830x1475 at the width the READMEs use —
  taller than the section it illustrates. Now the light capture is the base and
  the dark one is stacked on it, offset so it covers part of the light pane and
  leaves a strip of it showing; tops and heights match, so the same rows sit at
  the same height in both and can be read across.

- Every vendor mark is listed under that figure. The captures are one demo
  scene, and a scene has only as many panes as it has: that one came up a pane
  short of the roster, so `gpt` never got a row. The strip states the claim
  directly, from `assets/marks/`, so it stays right when a vendor is added.

## 1.3.2 — 2026-09-16

- A mirrored pane shows the remote's task title instead of a blank row. A
  mirror streamer runs no program of its own, so it has no terminal title at
  all — the title arrives in the `title` metadata slot, which the sidebar now
  reads when the terminal title says nothing. From
  [#2](https://github.com/hhdebb/herdr-radar/pull/2), by @larkinwc.

## 1.3.1 — 2026-09-16

- **The tab bar no longer polls itself into a pile-up.** The managed block asked
  Herdr to run the status command every 2 seconds with a 3-second timeout, so a
  tick that ran long was still running when the next one started. On Windows
  every tick is a fresh `cmd.exe` — Herdr's own config says so — and the overlap
  feeds itself: more overlap, slower machine, more timeouts, more overlap. On a
  24-core machine it ended at Herdr taking 12.5 cores, 35 console hosts, a
  hundred shells, and a desktop that would not move the mouse. Killing Herdr
  dropped the machine from saturated to 19%, and starting it brought the whole
  thing back within seconds.

  The interval is 6 seconds now and the timeout is derived from it, so the two
  cannot drift apart again; `npm run check` reads both back out of the generated
  block and fails if the interval is not the larger. The line the poll feeds is
  the current directory, which did not deserve a process three times a minute in
  the first place — Herdr's tab bar has no file source, so a command is the only
  way in, but it can be a quiet one.

  Anyone who installed an earlier version has the old numbers in their
  `config.toml`; re-running the plugin's configure step rewrites the block.

- The OSC7 hook no longer spends a process turning `/c/code/x` into `C:/code/x`.
  It runs before every prompt, and on Windows a subprocess is not free: measured
  on one machine, that single `cygpath` call cost about 150ms of kernel time per
  prompt. Parameter expansion gives the same answer — checked against `cygpath
  -m` on a deep path, on a bare drive root, and on another drive — and paths
  that are not Windows drives fall through untouched, which is what Linux and
  macOS need anyway. Both the bash and the zsh copies.

## 1.3.0 — 2026-09-14

- A mark with no colour of its own is drawn in ink — black on a light panel,
  white on a dark one — instead of inheriting Herdr's contextual default. That
  default is the sidebar's second-rank text grey, which left every brand that
  signs in black looking switched off beside the coloured ones. The sidebar
  block is rebuilt per appearance, so the two ends of the scale still follow
  the desktop.
- The working logo is no longer bold. The icon font ships one weight, so bold
  is synthesised by dilating the outline: the mark did not thicken, it grew,
  and a logo that changes size the moment a session stops working reads as a
  rendering fault. Working is still said three ways beside it — the spinner,
  the ring, and the title in the vendor's colour.
- Grok's mark is 15% larger than the shared fit. Two thin strokes running
  corner to corner fill a bounding box while the ink sits on a diagonal, so
  fitted like everything else it measures equal and reads a size smaller than
  the discs beside it.
- Antigravity and Kiro get their marks. Both SVGs were already in `tools/svg/`
  with nothing pointing at them; they are now glyphs `U+E1B2` and `U+E1B3` in
  the icon font, so the hand-mapped codepoint range in the README moves with
  them. Antigravity is keyed `agy` throughout, which is the id Herdr reports
  for it.
- A row whose terminal title says nothing but where the pane is now shows the
  agent's name instead. Codex never sets a title, and Antigravity and Kiro
  leave the shell's `<path>: <job>` form standing, so those rows read as the
  working directory the group header above them already named. Claude Code and
  grok write their own names and are untouched, as is any title an agent
  actually wrote.
- `dist/JetBrainsMonoHerdr-Regular.ttf` is rebuilt from the same JetBrains Mono
  2.304 base, carrying the same 29 icons as the icon font. It had been left at
  24 glyphs while the icon font grew, so a terminal that takes one font file and
  no fallback was missing the lifecycle marks as well as the newest vendors.
- Kiro wears the purple it publishes. Antigravity publishes a monochrome mark
  and so wears no colour at all, which is how every brand without a hue is
  treated here.
- The Spaces column colours every branded vendor, not just three. Which
  vendors get their own Spaces token was hardcoded in three separate places
  and had fallen behind the colour table, which is why Antigravity and Kiro
  were branded beside their titles and grey in Spaces. Gemini was in the same
  position and is fixed with them. All three places now read one roster.
- Fix the Spaces marks vanishing once a workspace carried enough vendors. A
  workspace's tokens went out in a single report, and Herdr rejects a patch
  over sixteen tokens whole rather than truncating it, without saying so. The
  workspace write is chunked now, like the pane writes already were.
- `grok` has an attribution row in `THIRD_PARTY_NOTICES.md`, which it never had.
- Amp, Devin and Qoder have marks. Herdr detects all three and the sidebar gave
  them a bare title and the fallback amber; they take U+E1B4–E1B6, leaving the
  two codepoints ahead of them for the pull request that draws Antigravity and
  Kiro. None of the three carries a colour: two sign in black, and Amp's red
  sits five degrees from the red that already means "waiting on you" here.
- Vendor colours are the vendors' own now, checked against the marks the
  companies publish: Kimi, DeepSeek and Qwen gain theirs, Cline and Kilo are
  carried at their own hue with a moved lightness (as published, one dies on a
  dark panel and the other on a light one), and the invented indigo and slate
  that Codex and Grok wore are gone. A brand that signs in black gets no
  colour at all — the cell leaves its `fg` unset, so the mark inherits the
  row's ink and follows the terminal's theme, which a static hex cannot.
- Only agent ids Herdr recognises are named under `rows_by_agent`. An id it
  does not know is not a warning: the config file fails to parse and every
  plugin falls back to defaults, keybindings included.
- The tab-bar `cwd` hook receives the pane it is answering for, like every
  other hook.
- Codex draws the OpenAI mark, the same one GPT has.
- The working spinner is eight-dot braille again. Six dots read thinner than
  the text beside them, and the icon font's twelve-spoke throbber only ever
  showed on a terminal carrying that font. A full braille cell is the mark
  that reads as motion from across the panel. The throbber's twelve glyphs
  left the font with it: an unused mark is one more thing to keep building.
- A working title wears its vendor's colour again, instead of one warm colour
  for all of them. With thirty rows the hue is what separates one running
  session from the next before any of them is read. This brings back a copy of
  the agent row per vendor (`rows_by_agent`): a value rule can colour a logo,
  whose value is the vendor's glyph, but not a title, whose value is prose.

Antigravity and Kiro — their marks, their names, their colours, and the
home-directory and title-fallback fixes that came with them — are
[#1](https://github.com/hhdebb/herdr-radar/pull/1), by @sizzlebop. It landed
squashed, so GitHub shows the pull request closed rather than merged; the
commit carries her authorship.

## 1.2.1

- Fix `agents_panel = herdr` reverting to the plugin a moment after it was
  saved. The daemon rewrites the managed blocks at startup when the sidebar
  block was written for a different logo variant, but the variant tag lives
  inside that block — and a panel handed back to Herdr has no block at all,
  which read as a variant that disagreed. The check now runs only while the
  block is there, because its absence is the whole record of that choice.
  Present since 1.1.0.

## 1.2.0

- The mark in front of a blocked row pulses instead of sitting still: the
  question mark and a quiet ring take turns in the same cell, about three
  quarters of a second each. Blocked is the one state that costs something to
  ignore, and it was the only event mark with no motion at all. Borrowed from
  Codex, which alternates `[ ! ]` with `[ . ]` in its terminal title while it
  waits for an answer.
- An agent's own blinking marker is dropped from the title — Codex writes
  `[ ! ]` / `[ . ]` into it while waiting. The row pulses its own mark for that
  state now, and two blinkers out of phase in one line is worse than either;
  the words after the bracket are kept. It also stops a title rewrite every
  second that said nothing new.
- The other halves of a split screen hang off the pane they were split from,
  the way a worktree's sessions hang off their checkout: one corner each, a
  grey one so the structure does not read louder than the row it holds. Panes
  sharing a tab also rank as one unit, so nothing unrelated lands between two
  halves of one screen.
- Fix the vendor colours 1.1.0 lost on every row below a group header. The rule
  matched the logo cell with `equals`, but an indented row's value carries a
  zero-width space and its indent in front of the glyph, so only a header's own
  row ever matched; it is `contains` now.
- A working row spins a twelve-spoke throbber from the icon font instead of a
  braille frame. Only the spoke widths change between frames, not the outer
  radius, so the shape turns without breathing. The plain-Unicode variant keeps
  the braille frames, and so does the merged JetBrains Mono build — it cannot be
  rebuilt here, it needs the upstream font as input.

## 1.1.0

Requires Herdr 0.9.0: the sidebar block now colours a logo by matching the
vendor's glyph, which older versions reject along with the rest of the file.

- Vendor colours come from per-value rules on one cell instead of a copy of the
  whole row per vendor. The block is 60% smaller, and Gemini joins the three
  vendors that had a colour of their own.
- A working row's title is bold, and the spinner in front of it is six-dot
  braille rather than eight — the two lower dots barely moved while the rest
  of the frame turned.
- Each frame sends only the tokens that changed, not all thirty-odd. A write
  that alters what is rendered costs Herdr about 100ms to answer, so the old
  full rewrite spent the frame budget queueing.
- The daemon no longer subscribes to `pane.updated`, which was mostly the echo
  of its own writes; agent status arrives on its own event now, and a slow
  heartbeat catches title changes.
- A daemon started by hand reads the plugin config again: without Herdr's
  injected config directory it silently ran on defaults.
- Refuse to write a sidebar row wider than Herdr's 16-token limit, which it
  answers by rejecting the whole config file.

## 1.0.4

- Drop a workspace name from the start of a title when the group header above already
  shows it; `trim_group_prefix` turns it off.

## 1.0.3

- The daemon applies the chosen order (default `active`) when it starts, not only from the
  server-startup hook; a first start by hand used to leave Herdr's own order until a restart.

## 1.0.2

- Refuse to install when `[theme.custom]` or a `[ui.sidebar.*]` table already exists outside
  the managed blocks; appending a second declaration broke Herdr's whole config.
- Appearance following records the original `[theme] name` / `auto_switch` on first write and
  `unconfigure` restores them.

## 1.0.1

- `unconfigure` now stops the daemon and clears every token before removing the blocks;
  `plugin uninstall` used to leave a detached daemon repainting a sidebar nobody rendered.
  `state-stop --purge` does the same clear on its own.
- Ghostty: the codepoint map is also written to `config.ghostty`, the file Ghostty reads
  alongside `config` on macOS.
- README: install from a checkout, boolean settings shown as `true`/`false`, the config
  file only exists after the first save, plugin log filtered by plugin, `herdr server stop`
  ends every pane.

## 1.0.0

First public release.

- Sidebar rows with vendor logos and lifecycle states; done and blocked marks are held
  until seen or answered; idle splits into fresh, idle and stale.
- Workspace headers, git worktree trees, Spaces column colouring.
- Two orders (`active`, `recent`) on top of Herdr's own, switchable per key.
- Tab-bar path, desktop light/dark following, settings popup.
- One-command install: managed config blocks, font and terminal codepoint map are set up
  on first start; `configure` / `install-font` actions to redo any step.
- Optional `render_hook` module for rewriting what is displayed.
