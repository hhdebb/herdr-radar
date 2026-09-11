# Changelog

## 1.3.0

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
- `dist/JetBrainsMonoHerdr-Regular.ttf` is rebuilt. It had been left at 24 icon
  glyphs while the icon font grew to 38, so a terminal that takes one font file
  and no fallback was missing the lifecycle marks and the throbber as well as
  the two new vendors. Same JetBrains Mono 2.304 base as before.
- Antigravity is azure and Kiro is white, so neither wears the generic amber
  any more. Kiro's white is the first vendor colour that cannot be one hex on
  both appearances, so vendor colours now vary by light and dark the way the
  freshness scale already did; on a light panel Kiro is ink.
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
