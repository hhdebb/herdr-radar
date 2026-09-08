<div align="center">

# herdr-radar

**すべてのエージェントをひと目で**

<img src="assets/banner.webp" alt="herdr-radar — すべてのエージェントをひと目で" width="100%">

<a href="https://github.com/hhdebb/herdr-radar/releases"><img src="https://img.shields.io/github/v/release/hhdebb/herdr-radar?style=flat-square&color=0797ff" alt="最新リリース"></a>
<a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%E2%89%A5%2018-0797ff?style=flat-square" alt="Node 18+"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-0797ff?style=flat-square" alt="MIT"></a>

<a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <b>日本語</b>

</div>

---

## これは何か

[Herdr](https://herdr.dev) のプラグインです。サイドバーの Agents 一覧を、読めるパネルに変えます。
誰が作業中か、誰があなたの返事を待っているか、誰が 2 時間放置されているか——ひとつずつ開かなくても
わかります。インストールすれば動き、サイドバーに表示するトークンだけを書き、エージェント本体にも
ペイン名にも触れません。

## なぜ必要か

コーディングエージェントを十数個開いていると、Herdr 標準の Agents 一覧は役に立ちません。
どのセッションも同じ灰色の 1 行、`done` は数秒で `idle` に畳まれ、質問してきているものと先週の
火曜に放置したものが同じ見た目です。結局ひとつずつ切り替えて確かめることになります。

herdr-radar はその情報をサイドバーに載せます。完了したセッションはあなたが見るまでチェックを
残し、質問は答えるまでマークを残し、動きのないセッションは薄くなり、同じプロジェクトの
セッションは 1 つの見出しの下に集まり、いちばん忙しいプロジェクトが先頭に来ます。

## 得られるもの

<img src="assets/sidebar.webp" alt="herdr-radar のサイドバー：グループ、状態マーク、アクティビティ順" width="100%">

- **状態が消えない。** チェックはペインにフォーカスするまで、クエスチョンマークはエージェントが
  再び動くまで残ります。idle は最後のターンからの経過時間で 3 段階に分かれ、放置された
  セッションは行ごと薄くなります。
- **一覧に構造がある。** ワークスペースごとの見出し、git worktree はリポジトリの下にツリーで、
  いちばん忙しいプロジェクトが先頭、Spaces 列も同じ色で塗られます。
- **周辺も追従する。** タブバーに現在のディレクトリ、デスクトップのライト／ダークに合わせて
  Herdr のテーマが切り替わり、設定ポップアップひとつで全オプションを扱えます。

## クイックスタート

```sh
herdr plugin install hhdebb/herdr-radar
```

インストールはこれだけです。初回起動時にプラグインが残りを自分で済ませます。Herdr の
`config.toml` に 3 つの管理ブロックを書き（マーカーコメントで囲み、その外には触れない）、
アイコンフォントをユーザーのフォントディレクトリに入れ（管理者権限不要）、Ghostty / kitty の
設定があればコードポイントの割り当てを書き込みます。

> [!IMPORTANT]
> プラグインは Herdr サーバーが起動時に立ち上げます。インストール後にサイドバーが変わらなければ、
> デーモンを一度手で起動してください：
> `herdr plugin action invoke hhdebb.herdr-radar.state-start`。
> Herdr の再起動（`herdr server stop` の後に `herdr`）でも構いませんが、全ペインのプロセスが終了します。
> フォントは新しいターミナルウィンドウから読み込まれます。ターミナルによっては完全な再起動が必要です。

> [!NOTE]
> Herdr 0.9.0 以上、Node 18 以上が必要です。Windows 11 と macOS で確認済み、Linux は未確認です。
> コードポイント割り当てのないターミナル（Windows Terminal、iTerm）と、Windows でタブバーが `cd` に
> 追従しない件は「トラブルシューティング」を参照してください。

キーは 2 つ、任意です。`config.toml` に貼り付けます。どちらも Herdr のプレフィックス（既定は
`ctrl+b`）経由なので、ペイン内のプログラムと衝突しません。

```toml
[[keys.command]]
key = "prefix+a"
type = "plugin_action"
command = "hhdebb.herdr-radar.view-flip"       # 並び順：active <-> recent

[[keys.command]]
key = "prefix+comma"
type = "plugin_action"
command = "hhdebb.herdr-radar.settings"        # 設定ポップアップ
```

GitHub ではなくチェックアウトから入れる場合：

```sh
git clone https://github.com/hhdebb/herdr-radar.git
herdr plugin link ./herdr-radar
herdr plugin action invoke hhdebb.herdr-radar.state-start
```

`plugin link` はビルド手順を実行しません。同じセットアップはデーモンの初回起動が行うので、
3 行目が必要です。

## サイドバーの見え方

```
dashboard
  ⣟ ✳ Implement OAuth scopes            ← working：アイコンフォントならスロバー、なければ点字
  ✓ ✳ Wire retry budget into dispatcher ← done：緑のチェック、見るまで保持
  └─  feature/mc-13200                  ← リポジトリの下の worktree
    ? Λ Which env file should I edit?   ← blocked：赤のクエスチョンマーク、質問中
billing
  ✳ Trace duplicate charges             ← idle：止まったばかり
  ✳ Migrate invoices table              ← idle が 2 時間以上：行ごと薄くなる
```

エージェントごとに 1 行。ロゴ、タイトル、状態に応じた色、タイトルの前に動きとマーク。並び順は
2 種類：`active` はグループを保ったまま両階層をアクティビティ順に、`recent` はフラットな
アクティビティ順。`prefix+a` で切り替えます。パネル全体を Herdr 本来の描画に戻す切り替えは
設定ポップアップにあります。

## 設定

`prefix+,` で設定ポップアップを開きます。`↑↓` 選択、`←→` 変更、`↵` テキスト編集、`r` 既定値、
`s` 保存して適用、`q` 閉じる。保存は設定ファイルの変更行だけを書き換え、デーモンを再起動します。

| 項目 | 既定値 | 内容 |
| --- | --- | --- |
| `agents_panel` | `plugin` | このプラグインのパネル、または `herdr` で Herdr 本来のパネル |
| `order` | `active` | `active` グループ化してアクティビティ順 / `recent` フラット / `off` Herdr の順序 |
| `variant` | `auto` | ロゴをアイコンフォント（`font`）、通常の Unicode（`text`）、なし（`none`）。`auto` はプラグインが入れたフォントを認識 |
| `done_hold` | `until_seen` | チェックをフォーカスまで保持、または秒数 |
| `blocked_hold` | `true` | エージェントが再び動くまでクエスチョンマークを保持 |
| `idle_grace_seconds` | `2.5` | ターン終了とみなすまで idle が続く必要のある時間 |
| `activity_fresh_minutes` | `15` | 最後のターンからこの時間は fresh |
| `activity_stale_minutes` | `120` | この時間ターンがなければ行が薄くなる |
| `group_indent` | `2` | 見出しの下のメンバーの字下げ幅。`0` でフラット |
| `group_gap` | `true` | グループ間の空行 |
| `show_tab` | `false` | タイトルの前にタブ番号 |
| `trim_group_prefix` | `true` | 見出しと同じ名前でタイトルが始まるとき、その部分を落とす |
| `worktree_mark` | `U+F418` | worktree 見出しのマーク（Nerd Font が必要）。空で非表示 |
| `follow_appearance` | `true` | デスクトップのライト／ダークに合わせて Herdr のテーマを切り替え |
| `colors.active_row_bg_light` | `#b9cdf2` | ライトテーマの選択行の背景。空ならテーマ自身の値 |
| `colors.active_row_bg_dark` | `#414868` | ダークテーマの選択行の背景 |

最初の 2 つはライブの状態です。残りは `$(herdr plugin config-dir hhdebb.herdr-radar)/config.toml`
にあり、手で編集してもかまいません。編集後は `state-stop`、続けて `state-start`。このファイルは
ポップアップが最初に保存したときに作られます。それより前に手で編集するなら、上の表のキーで自分で
作ってください（真偽値は引用符なし：`group_gap = false`）。

## トラブルシューティング

まず `herdr plugin log list --plugin hhdebb.herdr-radar --limit 20`。プラグインの各コマンドの出力と
エラーはそこにあります。

<details>
<summary><b>フォントを入れたのにロゴが四角やクエスチョンマークのまま</b></summary>

ターミナルがフォントを再読み込みしていません。新しいウィンドウを開くか、ターミナルを終了して
開き直してください。macOS はキャッシュがもう一段あります：`killall fontd fontworker` の後に開き直し。
</details>

<details>
<summary><b>ロゴがランダムな漢字で描かれる</b></summary>

別のフォントが同じ私用領域を主張しています（CJK フォントによくあります）。ターミナルは
`Herdr Agent Icons Max` にコードポイント単位で割り当てる必要があり、フォールバックに加えるだけでは
足りません。Ghostty / kitty：`herdr plugin action invoke hhdebb.herdr-radar.install-font` で書き込めます。
それ以外：`U+E1A0–U+E1B1` と `U+E1C0–U+E1C5` を手で割り当ててください。コードポイント割り当ての
ないターミナル（Windows Terminal、iTerm）は `dist/JetBrainsMonoHerdr-Regular.ttf` をターミナルの
フォントに——アイコンを埋め込んだ JetBrains Mono です。
</details>

<details>
<summary><b>インストールしても何も変わらない</b></summary>

デーモンが動いていません：`herdr plugin action invoke hhdebb.herdr-radar.state-start`。それでも
だめならプラグインのログでそのコマンドの出力を読んでください。よくある原因は、Herdr から
見える PATH に Node 18 以上がないこと、`config.toml` に管理ブロックを置く `[ui]` テーブルがないこと、
あるいは `[theme.custom]` / `[ui.sidebar.*]` テーブルを手で書いていることです。同じテーブルを 2 回
宣言するとファイル全体が壊れるので、プラグインは書き込みを拒否します。自分のものをどけるか、
そのままにして Herdr 本来のパネルを使ってください。
</details>

<details>
<summary><b>設定を変えたのに反映されない</b></summary>

デーモンは起動時に設定を読みます。設定ポップアップの `s` は再起動します。手で編集したあとは
`state-stop` の後に `state-start`。`config.toml` の 3 つの管理ブロックを直接編集しても、次の
`configure` で書き戻されます。
</details>

<details>
<summary><b>タブバーのパスが消えた、または 1 つのワークスペースでしか出ない</b></summary>

Herdr は幅を 1 列でも超えるとステータス領域を切り詰めずに丸ごと消します。環境変数
`HERDR_RADAR_TABBAR_MAX`（既定 48）を下げるか、サイドバーを狭くしてください。あるいは Herdr の
client と server のバージョンが違います（`herdr status` に `restart_needed: yes`）：
`herdr server stop` して開き直してください（全ペインのプロセスが終了します）。
</details>

<details>
<summary><b>Windows でタブバーがペイン起動時のディレクトリのまま</b></summary>

Windows の Herdr は `cd` を追えません。`~/.zshrc` または `~/.bashrc` から
`shell/herdr-osc7.zsh` / `.bash` を source してシェルに通知させてください。以後開いたペインに効きます。
</details>

<details>
<summary><b>設定ポップアップが一瞬で閉じる</b></summary>

Windows で `herdr plugin pane open` を手で実行するときは `--cwd <プラグインのディレクトリ>` が
必要です。ないと Herdr がペインに拡張長パスを渡し、Git Bash が入れません。割り当て済みの
`prefix+,` は渡しています。
</details>

<details>
<summary><b>エージェントが質問しているのにクエスチョンマークが出ない</b></summary>

プラグインは検出をせず、Herdr の判定を映すだけです。Herdr は画面上のダイアログの形で `blocked` を
判定し、認識できないものはすべて idle として扱います。`herdr agent explain <pane> --verbose` で
どのルールに一致したかが見えます。
</details>

## アンインストール

この順番で。`unconfigure` はデーモンを止め、書き込んだトークンをすべて消し、管理ブロックを
外します。プラグインが入っている間でないと呼び出せません。

```sh
herdr plugin action invoke hhdebb.herdr-radar.unconfigure
herdr plugin action invoke hhdebb.herdr-radar.uninstall-font
herdr plugin uninstall hhdebb.herdr-radar
```

残るのは設定のバックアップを含む状態ディレクトリ
`~/.local/state/herdr/plugins/hhdebb.herdr-radar`（Windows は `%LOCALAPPDATA%\herdr\plugins\...`）
だけです。何も残したくなければ手で削除してください。

## 仕組み

常駐デーモンが 1 つ。Herdr のイベントストリームで起こされ、フレームごとに `herdr agent list` から
スナップショットを取り、状態・グループ・ソートキーだけをサイドバーのトークンとして書きます。
ネットワークは使いません。Herdr の設定と自身の状態ディレクトリ以外で読むのは、セッション自身の
記録の末尾だけ——プラグインより古いペインに最終アクティビティ時刻を与えるためです。他の Herdr
プラグインと同じくあなたのユーザー権限で動き、Herdr はサンドボックス化しません。気になる場合は
導入前に `herdr-plugin.toml` と `bin/` を読んでください。

## ライセンスと謝辞

MIT。[LICENSE](LICENSE) を参照。[qintmb/herdr-icon-agent-ui](https://github.com/qintmb/herdr-icon-agent-ui)
からのフォークで、アイコンフォントと「1 コードポイント 1 ロゴ」の発想はそこから来ています。
フォント内のベンダーマークはそれぞれの所有者に帰属し、出典は
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) に記載。`dist/JetBrainsMonoHerdr-Regular.ttf` は
SIL OFL 1.1 のもとで改変・改名した JetBrains Mono で、ライセンス全文は `dist/OFL.txt` として同梱しています。
