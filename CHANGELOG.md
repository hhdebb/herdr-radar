# Changelog

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
