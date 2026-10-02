<div align="center">

# herdr-radar

**一眼看清每个 agent 在干什么**

<img src="assets/banner.webp" alt="herdr-radar — 一眼看清每个 agent 在干什么" width="100%">

<a href="https://github.com/hhdebb/herdr-radar/releases"><img src="https://img.shields.io/github/v/release/hhdebb/herdr-radar?style=flat-square&color=0797ff" alt="最新版本"></a>
<a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%E2%89%A5%2018-0797ff?style=flat-square" alt="Node 18+"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-0797ff?style=flat-square" alt="MIT"></a>

<a href="README.md">English</a> · <b>简体中文</b> · <a href="README.ja.md">日本語</a>

</div>

---

## 这是什么

一个 [Herdr](https://herdr.dev) 插件，把侧边栏的 Agents 列表改成一块能读的面板：谁在干活、
谁在等你回话、谁已经放了两个小时，不用逐个点开。装上就生效，只写侧边栏上显示用的
token，不碰 agent 本身，也不改你的面板名。

## 为什么需要它

同时开着十几个 coding agent 的时候，Herdr 原生的 Agents 列表帮不上忙：每个会话一行
一样的灰字，`done` 状态几秒钟就收成 `idle`，正在问你问题的那个和上周二放弃的那个长得
一模一样。你得一个个切进去看。

herdr-radar 把这些信息搬到侧边栏上：完工的勾一直亮到你看过，问号一直亮到你回答，
放久了的会话自己变暗，同一个项目的会话归到一个表头下面，最忙的项目排最上面。

## 你会得到什么

<img src="assets/sidebar.webp" alt="herdr-radar 侧边栏在亮色与暗色桌面下：分组、状态标记、按活跃度排序" width="100%">

- **状态不会溜走。** 完工的勾保持到你聚焦那个面板，问号保持到 agent 重新干活，
  idle 按最后一轮距今多久分三档，放弃的会话整行变暗。
- **列表有结构。** 工作区有表头，git worktree 挂在它的仓库下面成树，同一块分屏的面板挨在
  一起，最忙的项目排最前，Spaces 那一栏跟着状态着色。
- **周边跟着配套。** 标签栏显示当前目录，桌面明暗翻转时 Herdr 主题跟着切，
  一个设置弹窗管所有选项。

## 快速开始

```sh
herdr plugin install hhdebb/herdr-radar
```

就这一句。插件第一次启动时自己完成剩下的事：把三个托管块写进 Herdr 的 `config.toml`
（用标记注释圈定，标记之外不碰），把图标字体装进你的用户字体目录（不需要管理员权限），
Ghostty / kitty 的配置存在的话写入码位映射。

> [!IMPORTANT]
> 插件由 Herdr 服务端在启动时拉起，装完侧边栏还没变化，就手动起一次：
> `herdr plugin action invoke hhdebb.herdr-radar.state-start`。
> 重启 Herdr（`herdr server stop` 后再 `herdr`）也行，但它会结束所有面板里正在跑的进程。
> 新开的终端窗口才会加载字体，有的终端要整个重启。

> [!NOTE]
> 需要 Herdr 0.9.0+ 和 Node 18+。Windows 11 和 macOS 实测过，Linux 尚未实测。
> 没有按码位映射的终端（Windows Terminal、iTerm）和 Windows 上标签栏不跟 `cd` 的问题，
> 见「常见问题」。

绑两个键（可选，粘进 `config.toml`）。都走 Herdr 的 prefix，默认 `ctrl+b`，不会和面板里的
程序撞车：

```toml
[[keys.command]]
key = "prefix+a"
type = "plugin_action"
command = "hhdebb.herdr-radar.view-flip"       # 排序：active <-> recent

[[keys.command]]
key = "prefix+comma"
type = "plugin_action"
command = "hhdebb.herdr-radar.settings"        # 设置弹窗
```

不走 GitHub、从检出目录装：

```sh
git clone https://github.com/hhdebb/herdr-radar.git
herdr plugin link ./herdr-radar
herdr plugin action invoke hhdebb.herdr-radar.state-start
```

`plugin link` 不跑构建步骤，同样的初始化由守护进程首次启动时完成，第三行就是为此。

### 或者交给 agent 装

把下面这段粘给任意编码 agent，它就知道怎么装：

```text
在这台机器上安装 Herdr 的 herdr-radar 插件。

1. herdr plugin install hhdebb/herdr-radar
2. herdr plugin action invoke hhdebb.herdr-radar.state-start
3. 确认装上了：`herdr plugin list` 里 hhdebb.herdr-radar 是 enabled，
   并且 `herdr agent list` 里跑着 agent 的面板带上了 `sort_key` token
   （这个 token 与状态无关一直都在；徽标那个 token 的名字会随状态变）。

不要执行 `herdr server stop`，也不要杀 Herdr 进程。那会结束所有面板里的
所有程序，包括正在跑你的那个。这里没有任何一步需要重启：插件首次启动会自己
完成配置，新开的终端窗口会自己认到图标字体。

需要 Herdr 0.9.0 以上和 Node 18 以上。如果标记显示成方框，是这个终端没有
对应的码位映射 —— 这种情况和其余问题都在 https://github.com/hhdebb/herdr-radar
的 Troubleshooting 一节里。
```

## 侧边栏长什么样

```
dashboard
  ⣟ ✳ Implement OAuth scopes            ← working：盲文转圈，标题用厂商色
  ✓ ✳ Wire retry budget into dispatcher ← done：绿勾，保持到你看过
  └─  feature/mc-13200                  ← worktree 挂在它的仓库下面
    ? Λ Which env file should I edit?   ← blocked：一闪一闪的红标记，它在问你
billing
  ✳ Trace duplicate charges             ← idle：刚停下
  ✳ Migrate invoices table              ← idle 两小时以上：整行变暗
```

每个 agent 一行：logo、标题，颜色随状态走，动画和标记放在标题前面。两种排序：`active`
保留分组、两层都按活跃度排；`recent` 是扁平的活跃度列表，`prefix+a` 互切。整个面板也能
交还给 Herdr 原生渲染，开关在设置里。

## 颜色怎么读

一行里值得一眼看清的有两件事，它们分开承载：**logo** 说这是谁家的 agent，**标题**说这个
agent 正在干什么。两者互不影响。

logo 穿的是厂商自己的颜色，而且只穿厂商**公开过**的那一个。一个把自己签成黑色或白色的品牌
没有色相可借，那它的标记就用墨色画 —— 亮色面板上是黑的，暗色面板上是白的 —— 而不是替它编
一个颜色。状态再怎么变，logo 不变。

标题承载状态，而且形状也在承载，所以即使不看颜色，这块面板照样读得懂：

| 状态 | 标题 | 标题前面 |
| --- | --- | --- |
| 在跑 | 厂商色 | 盲文转轮，转着 |
| 等你决策 | 红 | 问号，一闪一闪 |
| 干完了 | 绿 | 对勾，你看过那个面板才消 |
| 空闲 | 下面那条活跃度刻度 | 圆环 |
| 未知 | 紫 | 圆环 |

绿和红是语义色，压过品牌 —— 它们的职责就是拽住视线，所以没有哪个厂商色可以是这两种。在跑的
标题用厂商色而不是统一的「忙碌色」，是因为三十行同屏时，在你读到任何一行的字之前，色相就已经
把一个在跑的会话和下一个分开了。

**空闲不是一个状态，是一条渐变。** agent 一停下，剩下的唯一问题就是「停了多久」，所以标题
随着距上次动作的时间变冷：头 15 分钟读作刚停下，之后是普通文字色直到两小时，再往后**整行变暗**
—— logo、标记一起 —— 并沉到本组底部。两个门槛都是设置项（`activity_fresh_minutes`、
`activity_stale_minutes`）。三档画的是同一个圆环，靠颜色区分：一个随着变旧而改变形状的标记，
等于要人学三遍。

Spaces 那一列用的是同一套厂商色，所以在那边也分得出哪个工作区在跑 Claude、哪个在跑 Gemini。

## 支持哪些 agent

二十五家有自己的标记：

<!-- prettier-ignore -->
| | | | |
| --- | --- | --- | --- |
| <img src="assets/marks/amp.svg" width="15" align="top"> Amp | <img src="assets/marks/agy.svg" width="15" align="top"> Antigravity | <img src="assets/marks/claude.svg" width="15" align="top"> Claude Code | <img src="assets/marks/cline.svg" width="15" align="top"> Cline |
| <img src="assets/marks/codex.svg" width="15" align="top"> Codex | <img src="assets/marks/copilot.svg" width="15" align="top"> Copilot | <img src="assets/marks/cursor.svg" width="15" align="top"> Cursor | <img src="assets/marks/deepseek.svg" width="15" align="top"> DeepSeek |
| <img src="assets/marks/devin.svg" width="15" align="top"> Devin | <img src="assets/marks/gemini.svg" width="15" align="top"> Gemini | <img src="assets/marks/glm.svg" width="15" align="top"> GLM | <img src="assets/marks/gpt.svg" width="15" align="top"> GPT |
| <img src="assets/marks/grok.svg" width="15" align="top"> Grok | <img src="assets/marks/hermes.svg" width="15" align="top"> Hermes | <img src="assets/marks/kilo.svg" width="15" align="top"> Kilo | <img src="assets/marks/kimchi.svg" width="15" align="top"> Kimchi |
| <img src="assets/marks/kimi.svg" width="15" align="top"> Kimi | <img src="assets/marks/kiro.svg" width="15" align="top"> Kiro | <img src="assets/marks/maki.svg" width="15" align="top"> Maki | <img src="assets/marks/mastracode.svg" width="15" align="top"> Mastra |
| <img src="assets/marks/omp.svg" width="15" align="top"> Oh My Pi | <img src="assets/marks/opencode.svg" width="15" align="top"> OpenCode | <img src="assets/marks/pi.svg" width="15" align="top"> Pi | <img src="assets/marks/qodercli.svg" width="15" align="top"> Qoder |
| <img src="assets/marks/qwen.svg" width="15" align="top"> Qwen | | | |

Herdr 还认得另外三家，Droid、Letta 和 Muse，这三家都没有本项目能用的公开标记。它们的行跟别的行一样
工作 —— 状态、颜色、排序、分组都正常 —— 只是穿的是通用标记而不是自己的。欢迎发 PR 把它们补上；
Antigravity 和 Kiro 的标记就是这么来的。

Herdr 认得而这里没列出的，显示方式也一样：通用标记、一个自己的颜色，其余一切照常。

### 当进程名不等于厂商

GLM 的会话跑的是原装 `claude` 二进制，只是指向了一个 Anthropic 兼容的端点，所以 Herdr
检测出来就是 `claude` —— 没错，而且永远如此。任何包装已知二进制的做法都一样。检测看不穿
这一层，本插件也看不穿：这个面板在干什么，只有启动它的人知道。

那就让包装脚本自己说。Herdr 留了一个纯显示用的字段，`exec` 之前加一行就够：

```sh
herdr pane report-metadata "$HERDR_PANE_ID" --source user:cglm --display-agent glm
exec claude "$@"
```

这一行随即换上 GLM 的标记和名字。`--clear-display-agent` 撤销。本插件不认得的值会被忽略
而不是把行清空，所以像 `Claude: auth` 这种人话标签仍然保留 Claude 的标记。

## 设置

`prefix+,` 打开设置弹窗：`↑↓` 选，`←→` 改，`↵` 编辑文本，`r` 恢复默认，`s` 保存并应用，
`q` 关闭。保存只改写配置文件里变动的那几行，然后重启守护进程。

| 项 | 默认 | 作用 |
| --- | --- | --- |
| `agents_panel` | `plugin` | 用本插件的面板，或 `herdr` 原生面板 |
| `order` | `active` | `active` 分组按活跃度 / `recent` 扁平 / `off` Herdr 的顺序 |
| `variant` | `auto` | logo 来源：`font` 图标字体 / `text` 普通 Unicode / `none`。`auto` 认插件自己装的字体 |
| `done_hold` | `until_seen` | 勾保持到聚焦面板，或改成秒数 |
| `blocked_hold` | `true` | 问号保持到 agent 重新干活 |
| `idle_grace_seconds` | `2.5` | idle 持续这么久才算一轮结束 |
| `activity_fresh_minutes` | `15` | 最后一轮之后多久内算 fresh |
| `activity_stale_minutes` | `120` | 多久没动算 stale，整行变暗 |
| `group_indent` | `2` | 成员缩进几格，`0` 平铺 |
| `group_gap` | `true` | 组之间留空行 |
| `split_corner` | `false` | 分屏的其余面板用 `├─` 角标挂在第一个下面 |
| `row_label` | `title` | 行显示什么：`title` 会话标题、`tab` tab 名、`both` 两者都显示（原 `show_tab = true`） |
| `trim_group_prefix` | `true` | 标题开头与分组表头同名时去掉那一截 |
| `worktree_mark` | `U+F418` | worktree 表头的标记，需要 Nerd Font；置空不画 |
| `follow_appearance` | `true` | 跟随桌面明暗切换 Herdr 主题 |
| `colors.active_row_bg_light` | `#b9cdf2` | 浅色主题的选中行底色；置空用主题自己的 |
| `colors.active_row_bg_dark` | `#414868` | 深色主题的选中行底色 |

前两项是实时状态，其余存在 `$(herdr plugin config-dir hhdebb.herdr-radar)/config.toml`，
手改也行，改完 `state-stop` 再 `state-start`。这个文件在弹窗第一次保存时才出现，之前要手改就按上表的键
自己建一个（布尔值不加引号：`group_gap = false`）。

## 常见问题

先看 `herdr plugin log list --plugin hhdebb.herdr-radar --limit 20`，插件的每条命令在那里都有输出和报错。

<details>
<summary><b>装了字体，logo 还是方块或问号</b></summary>

终端还没重新加载字体。新开一个终端窗口；不行就把终端整个退出再开。macOS 多一层缓存：
`killall fontd fontworker` 再重开终端。
</details>

<details>
<summary><b>logo 画成了一个随机汉字</b></summary>

这段私有区被别的字体抢了，CJK 字体尤其常见。终端必须按码位映射到 `Herdr Agent Icons Max`，
只加进 fallback 家族不够。Ghostty / kitty 跑一次 `herdr plugin action invoke hhdebb.herdr-radar.install-font`
就写好了；其他终端手动映射 `U+E1A0–U+E1B8` 和 `U+E1C0–U+E1C5`。没有按码位映射能力的终端
（Windows Terminal、iTerm）改用 `dist/JetBrainsMonoHerdr-Regular.ttf` 当主字体，它是打进了
图标的 JetBrains Mono。

Ghostty 上只有 `ghostty +show-face` 能说明映射到底生没生效，`+show-config` 和 `+list-fonts`
两种情况下都一样通过。v1.3.7 及以前写进去的那行是失效的（家族名带了引号），
重跑一次安装动作即可。
</details>

<details>
<summary><b>装完侧边栏一点变化都没有</b></summary>

守护进程没起来，`herdr plugin action invoke hhdebb.herdr-radar.state-start`。还不行就看
插件日志里这条的输出。最常见的原因：Herdr 看到的 PATH 上没有 Node 18+，
`config.toml` 里没有 `[ui]` 表让托管块落脚，或者你自己手写过 `[theme.custom]` / `[ui.sidebar.*]`
表：插件会拒绝写入而不是让同一个表出现两次（那会让整个配置文件失效）。把你的挪开，或者留着它、
用 Herdr 原生面板。
</details>

<details>
<summary><b>改了配置没生效</b></summary>

守护进程只在启动时读配置。设置弹窗里按 `s` 会自动重启；手改文件后 `state-stop` 再 `state-start`。
直接改 `config.toml` 里的三个托管块不算数，下次 `configure` 会写回去。
</details>

<details>
<summary><b>标签栏的路径不见了，或者只在某一个工作区显示</b></summary>

Herdr 的状态区超宽时整块丢掉而不是截断，差一列都不行。调小环境变量 `HERDR_RADAR_TABBAR_MAX`
（默认 48）或收窄侧边栏。另一种可能是 Herdr 的 client 和 server 版本不一致（`herdr status` 里
`restart_needed: yes`），`herdr server stop` 后重开（会结束所有面板里的进程）。
</details>

<details>
<summary><b>Windows 上标签栏一直显示面板启动时的目录</b></summary>

Herdr 在 Windows 上跟不到 `cd`。在 `~/.zshrc` 或 `~/.bashrc` 里 source
`shell/herdr-osc7.zsh` / `.bash`，让 shell 自己上报，只对之后新开的面板生效。
</details>

<details>
<summary><b>设置弹窗一闪就关</b></summary>

Windows 上手动 `herdr plugin pane open` 时要带 `--cwd <插件目录>`，否则 Herdr 给面板的是
扩展长度路径，Git Bash 进不去。绑定的 `prefix+,` 已经带了，不受影响。
</details>

<details>
<summary><b>agent 明明在问我，侧边栏没有问号</b></summary>

插件不做检测，只镜像 Herdr 的判断。Herdr 靠识别屏幕上对话框的样子判定 blocked，认不出的
一律当 idle。`herdr agent explain <pane> --verbose` 能看到它匹配了哪些规则。
</details>

## 卸载

按这个顺序：`unconfigure` 会停掉守护进程、清掉它写过的所有 token、摘掉托管块，而且插件还在
才调得到它：

```sh
herdr plugin action invoke hhdebb.herdr-radar.unconfigure
herdr plugin action invoke hhdebb.herdr-radar.uninstall-font
herdr plugin uninstall hhdebb.herdr-radar
```

留下的只有状态目录和里面的配置备份：`~/.local/state/herdr/plugins/hhdebb.herdr-radar`
（Windows 是 `%LOCALAPPDATA%\herdr\plugins\...`），想一点不剩就手动删掉。

## 工作方式

一个常驻守护进程，由 Herdr 的事件流唤醒，每帧从 `herdr agent list` 取快照，只把状态、
分组、排序键写成侧边栏 token。无网络；Herdr 配置和自己的状态目录之外只读会话记录的尾巴，
给比插件更老的面板补一个最后活跃时间。和所有 Herdr 插件一样以你的用户身份运行，Herdr
不沙箱插件，在意的话装之前看一眼 `herdr-plugin.toml` 和 `bin/`。

## 许可与致谢

MIT，见 [LICENSE](LICENSE)。派生自 [qintmb/herdr-icon-agent-ui](https://github.com/qintmb/herdr-icon-agent-ui)，
图标字体和"一个码位一个 logo"的思路来自它。字体里的厂商标记归各自所有者，来源见
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)；`dist/JetBrainsMonoHerdr-Regular.ttf` 是按
SIL OFL 1.1 修改并改名的 JetBrains Mono，许可全文随附为 `dist/OFL.txt`。
