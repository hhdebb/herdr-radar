# Changelog

## Unreleased

- The mark in front of a blocked row pulses instead of sitting still: the
  question mark and a quiet ring take turns in the same cell, about three
  quarters of a second each. Blocked is the one state that costs something to
  ignore, and it was the only event mark with no motion at all. Borrowed from
  Codex, which alternates `[ ! ]` with `[ . ]` in its terminal title while it
  waits for an answer.
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
