# Third-party notices

This project is a fork of [qintmb/herdr-icon-agent-ui](https://github.com/qintmb/herdr-icon-agent-ui)
(MIT). The icon font, the SVG marks and the glyph design are inherited from it; the runtime was
rewritten. See `LICENSE`.

Font marks in `assets/svg/` are sourced from the following projects. Marks identify third-party products and do not imply affiliation or endorsement.

| Icon | Source |
|---|---|
| claude | Anthropic `cwc-workshops` (Apache-2.0) |
| codex | OpenAI `codex` (Apache-2.0) |
| opencode | anomalyco `opencode` (MIT) |
| omp | can1357 `oh-my-pi` (MIT) |
| cline | Cline (MIT) |
| mastracode | MastraCode (MIT) |
| kimi | Moonshot AI Kimi Code CLI (Apache-2.0) |
| kilo | Kilo Code CLI (Apache-2.0) |
| maki | Maki (MIT) |
| pi | Pi coding agent |
| hermes | Hermes Agent |
| cursor | Cursor (proprietary) |
| copilot | GitHub Copilot (proprietary) |
| deepseek | DeepSeek (proprietary) |
| gemini | Google Gemini (proprietary) |
| gpt | OpenAI (proprietary) |
| qwen | Alibaba Qwen (proprietary) |
| grok | xAI Grok (proprietary) |
| agy | Google Antigravity (proprietary) |
| kiro | AWS Kiro (proprietary) |

Marks for `cursor`, `opencode`, `hermes`, `copilot`, `deepseek`, `gemini`,
`gpt`, `qwen`, `agy`, and `kiro` were taken from [lobehub/lobe-icons](https://github.com/lobehub/lobe-icons)
(MIT) and re-normalized to bare `<path>` geometry. The MIT license covers that
project's packaging, not the trademarks of the depicted brands.

See each project's repository for license details and modifications.

## JetBrains Mono

`dist/JetBrainsMonoHerdr-Regular.ttf` is JetBrains Mono v2.304 (© 2020 The JetBrains
Mono Project Authors, SIL Open Font License 1.1) with this project's 38 icon glyphs
patched in and the family renamed to "JetBrains Mono Herdr", as the OFL requires for a
modified build. The OFL text ships alongside it as `dist/OFL.txt`; the font's own
copyright and license name records are kept intact.
Source: https://github.com/JetBrains/JetBrainsMono

`dist/HerdrAgentIconsMax-Regular.ttf` is built from the SVG marks above and contains no
JetBrains Mono outlines; only its vertical metrics (units per em, advance width, ascent
and descent) are copied so the icons sit on the same line as that face.
