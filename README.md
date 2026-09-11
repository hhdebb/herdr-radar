<div align="center">

# herdr-radar

**See every agent at a glance**

<img src="assets/banner.webp" alt="herdr-radar — see every agent at a glance" width="100%">

<a href="https://github.com/hhdebb/herdr-radar/releases"><img src="https://img.shields.io/github/v/release/hhdebb/herdr-radar?style=flat-square&color=0797ff" alt="Latest release"></a>
<a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%E2%89%A5%2018-0797ff?style=flat-square" alt="Node 18+"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-0797ff?style=flat-square" alt="MIT"></a>

<b>English</b> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.ja.md">日本語</a>

</div>

---

## What it is

A [Herdr](https://herdr.dev) plugin that turns the sidebar's Agents list into something you
can read: who is working, who is waiting on you, who has been parked for two hours — without
opening each one. It takes effect on install, writes only the display tokens the sidebar
shows, and never touches the agents themselves or your pane names.

## Why

With a dozen coding agents open, Herdr's own Agents list does not help: every session is a
line of the same grey text, `done` collapses into `idle` within seconds, and the one asking
you a question looks exactly like the one abandoned last Tuesday. You end up switching into
each pane to find out.

herdr-radar puts that information on the sidebar: a finished session keeps its tick until you
have looked, a question keeps its mark until you answer, sessions that have gone quiet fade,
sessions of one project sit under one header, and the busiest project sits on top.

## What you get

<img src="assets/sidebar.webp" alt="herdr-radar sidebar: groups, state marks, activity order" width="100%">

- **State does not slip away.** The tick stays until you focus the pane, the question mark
  stays until the agent works again, idle splits into three tiers by time since the last
  turn, and abandoned sessions dim as a whole row.
- **The list has structure.** Workspaces get headers, git worktrees hang under their repository
  as a tree, the halves of a split screen hang off the pane they came from, the busiest project
  sorts first, and the Spaces column takes the same colours.
- **The surroundings follow.** The tab bar shows the current directory, Herdr's theme switches
  with the desktop's light and dark, and one settings popup holds every option.

## Quick start

```sh
herdr plugin install hhdebb/herdr-radar
```

That is the whole install. On its first start the plugin finishes the rest itself: it writes
three managed blocks into Herdr's `config.toml` (fenced by marker comments, nothing outside
them is touched), installs the icon font into your user font directory (no admin rights
needed), and writes the codepoint map into Ghostty / kitty configs if they exist.

> [!IMPORTANT]
> Herdr starts plugins from its server at startup. If the sidebar has not changed after
> installing, start the daemon once:
> `herdr plugin action invoke hhdebb.herdr-radar.state-start`.
> Restarting Herdr (`herdr server stop`, then `herdr`) works too, but it ends every process in
> every pane. New terminal windows pick up the font; some terminals need a full restart.

> [!NOTE]
> Requires Herdr 0.9.0+ and Node 18+. Tested on Windows 11 and macOS; Linux not yet.
> Terminals without a codepoint map (Windows Terminal, iTerm) and the tab bar not following
> `cd` on Windows are covered under *Troubleshooting*.

Two keys, optional — paste into `config.toml`. Both go through Herdr's prefix (`ctrl+b` by
default), so they cannot collide with anything running inside a pane:

```toml
[[keys.command]]
key = "prefix+a"
type = "plugin_action"
command = "hhdebb.herdr-radar.view-flip"       # order: active <-> recent

[[keys.command]]
key = "prefix+comma"
type = "plugin_action"
command = "hhdebb.herdr-radar.settings"        # settings popup
```

From a checkout instead of GitHub:

```sh
git clone https://github.com/hhdebb/herdr-radar.git
herdr plugin link ./herdr-radar
herdr plugin action invoke hhdebb.herdr-radar.state-start
```

`plugin link` runs no build step; the daemon does the same setup on its first start, which is
what the third line is for.

## What the sidebar looks like

```
dashboard
  ⣟ ✳ Implement OAuth scopes            ← working: a throbber with the icon font, braille without
  ✓ ✳ Wire retry budget into dispatcher ← done: green tick, held until you look
  └─  feature/mc-13200                  ← a worktree under its repository
    ? Λ Which env file should I edit?   ← blocked: a pulsing red mark, it is asking you
billing
  ✳ Trace duplicate charges             ← idle: just stopped
  ✳ Migrate invoices table              ← idle for two hours: the whole row dims
```

One row per agent: logo, title, colour by state, motion and marks in front of the title. Two
orders: `active` keeps the groups and ranks by activity at both levels; `recent` is a flat
list by activity — `prefix+a` flips between them. The whole panel can be handed back to
Herdr's own rendering from the settings popup.

## Settings

`prefix+,` opens the settings popup: `↑↓` select, `←→` change, `↵` edit a text value, `r`
reset to default, `s` save and apply, `q` close. Saving rewrites only the changed lines of
the config file and restarts the daemon.

| Option | Default | Does |
| --- | --- | --- |
| `agents_panel` | `plugin` | this plugin's panel, or `herdr` for Herdr's own |
| `order` | `active` | `active` grouped by activity / `recent` flat / `off` Herdr's order |
| `variant` | `auto` | logos from the icon font (`font`), plain Unicode (`text`), or `none`; `auto` recognises the font the plugin installed |
| `done_hold` | `until_seen` | keep the tick until the pane is focused, or a number of seconds |
| `blocked_hold` | `true` | keep the question mark until the agent works again |
| `idle_grace_seconds` | `2.5` | idle must persist this long to count as a finished turn |
| `activity_fresh_minutes` | `15` | how long after the last turn a pane still reads as fresh |
| `activity_stale_minutes` | `120` | how long without a turn before the row dims |
| `group_indent` | `2` | member indent under a header; `0` for a flat list |
| `group_gap` | `true` | a blank row between groups |
| `show_tab` | `false` | tab number in front of the title |
| `trim_group_prefix` | `true` | drop the workspace name from a title when the header above already shows it |
| `worktree_mark` | `U+F418` | the mark on a worktree header, needs a Nerd Font; empty for none |
| `follow_appearance` | `true` | switch Herdr's theme with the desktop's light/dark |
| `colors.active_row_bg_light` | `#b9cdf2` | selected-row fill for a light theme; empty keeps the theme's own |
| `colors.active_row_bg_dark` | `#414868` | selected-row fill for a dark theme |

The first two are live state; the rest live in
`$(herdr plugin config-dir hhdebb.herdr-radar)/config.toml` and can be edited by hand —
then `state-stop` and `state-start`. The file appears the first time the popup saves; before
that, create it with the keys above (booleans unquoted: `group_gap = false`).

## Troubleshooting

Start with `herdr plugin log list --plugin hhdebb.herdr-radar --limit 20`: every plugin command
leaves its output and errors there.

<details>
<summary><b>Font installed, logos still show as boxes or question marks</b></summary>

The terminal has not reloaded its fonts. Open a new window; if that is not enough, quit the
terminal and reopen it. macOS keeps an extra cache: `killall fontd fontworker`, then reopen.
</details>

<details>
<summary><b>A logo renders as a random CJK character</b></summary>

Another font claimed the same Private Use Area — CJK fonts often do. The terminal must map the
codepoints to `Herdr Agent Icons Max`; adding it as a fallback family is not enough. Ghostty /
kitty: `herdr plugin action invoke hhdebb.herdr-radar.install-font` writes the map. Other
terminals: map `U+E1A0–U+E1B3` and `U+E1C0–U+E1C5` by hand. Terminals with no codepoint map
(Windows Terminal, iTerm): use `dist/JetBrainsMonoHerdr-Regular.ttf` as the terminal font —
JetBrains Mono with the icons patched in.
</details>

<details>
<summary><b>Nothing changed after installing</b></summary>

The daemon is not running: `herdr plugin action invoke hhdebb.herdr-radar.state-start`. If it
still does not, read that command's output in the plugin log. The usual causes: no
Node 18+ on the PATH Herdr sees, no `[ui]` table in `config.toml` for the managed block to
attach to, or a `[theme.custom]` / `[ui.sidebar.*]` table you wrote by hand — the plugin
refuses rather than declare a table twice, which would break the whole file. Move yours out of
the way, or keep it and use Herdr's own panel.
</details>

<details>
<summary><b>Changed a setting, nothing happened</b></summary>

The daemon reads its config at start. `s` in the settings popup restarts it; after a hand edit,
`state-stop` then `state-start`. Editing the three managed blocks in `config.toml` directly
does not stick — the next `configure` writes them back.
</details>

<details>
<summary><b>The tab bar path disappeared, or shows in one workspace only</b></summary>

Herdr drops the whole status area when it is one column too wide rather than truncating it.
Lower the `HERDR_RADAR_TABBAR_MAX` environment variable (default 48) or narrow the sidebar. Or
Herdr's client and server versions differ (`restart_needed: yes` in `herdr status`):
`herdr server stop` and reopen.
</details>

<details>
<summary><b>On Windows the tab bar shows the directory a pane started in</b></summary>

Herdr cannot follow `cd` on Windows. Source `shell/herdr-osc7.zsh` / `.bash` from your
`~/.zshrc` or `~/.bashrc` so the shell reports it; applies to panes opened afterwards.
</details>

<details>
<summary><b>The settings popup closes at once</b></summary>

On Windows, `herdr plugin pane open` needs `--cwd <plugin directory>`; without it Herdr hands
the pane an extended-length path Git Bash cannot enter. The bound `prefix+,` already passes it.
</details>

<details>
<summary><b>The agent is asking me something, but there is no question mark</b></summary>

The plugin does no detection of its own; it mirrors Herdr's verdict. Herdr recognises
`blocked` from the shape of the dialog on screen and treats anything it does not recognise as
idle. `herdr agent explain <pane> --verbose` shows which rules matched.
</details>

## Uninstall

In this order — `unconfigure` stops the daemon, clears every token it wrote and removes the
managed blocks, and it needs the plugin still installed to be invoked at all:

```sh
herdr plugin action invoke hhdebb.herdr-radar.unconfigure
herdr plugin action invoke hhdebb.herdr-radar.uninstall-font
herdr plugin uninstall hhdebb.herdr-radar
```

What stays is the state directory with its config backups,
`~/.local/state/herdr/plugins/hhdebb.herdr-radar` (`%LOCALAPPDATA%\herdr\plugins\...` on
Windows); delete it by hand if you want nothing left.

## How it works

One resident daemon, woken by Herdr's event stream, takes a snapshot from `herdr agent list`
each frame and writes only states, groups and sort keys as sidebar tokens. No network; outside
Herdr's config and its own state directory it reads one thing, the tail of a session's own
transcript, to give panes older than the plugin a last-activity time. Like every Herdr plugin
it runs as your user and Herdr does not sandbox it — read `herdr-plugin.toml` and `bin/` before
installing if that matters to you.

## License and credits

MIT, see [LICENSE](LICENSE). Forked from [qintmb/herdr-icon-agent-ui](https://github.com/qintmb/herdr-icon-agent-ui),
which contributed the icon font and the one-codepoint-per-logo idea. Vendor marks in the font
belong to their owners; sources in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
`dist/JetBrainsMonoHerdr-Regular.ttf` is JetBrains Mono modified and renamed under the SIL OFL
1.1; the license text ships as `dist/OFL.txt`.
