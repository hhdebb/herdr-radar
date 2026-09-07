# Changelog

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
