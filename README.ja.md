# Tamagent

[한국어](README.md) · [English](README.en.md) · [日本語](README.ja.md) · [中文](README.zh.md)

エージェントが作業しているあいだ、小さなピクセルの仲間たちが動きます。Tamagent は、メインエージェントと実行中のサブエージェントをパネルに表示する Claude Code の mod です。名前は「たまごっち」と「エージェント」を組み合わせたものです。JSON を出力するスクリプトを用意すれば、ほかのツールもつなげられます。

![Tamagent のエージェントパネル](docs/screenshot-en.png)


## インストール

関数フック mod に対応した Claude Code のビルドが必要です。このリポジトリは 2.1.295 の API とテストエンジンを対象にしています。ターミナル版 Claude Code セッションのプロンプトで、次のように入力してください。

```text
/plugin install tamagent --marketplace Bum-Boo/tamagent
```

`Add marketplace?` には `y` と答え、スコープを選び(個人で使うなら `user`)、設定画面を最後まで進めます。デフォルトのままでも外部ツールなしで動きます。mod はすぐに有効になります。デスクトップ版の Code タブがこのインストールコマンドに対応していない場合は、ターミナルから user スコープでインストールしてください。

ローカルで開発するときは `claude --plugin-dir /path/to/tamagent` を実行します。

## 使い方

```text
/tama
```

- メインエージェントは、ツール呼び出しの実行中は作業し、それ以外は休んでいます。サブエージェントは `running` のとき作業し、`pending`、`waiting`、`idle` のときは休み、終わると消えます。
- **List** でテキストのリスト表示に切り替わります。**Characters** でキャラクター表示に戻ります。
- **Switch characters** を押すと、現在のスキンのキャラクターが順に切り替わります。**Default characters** で設定どおりの割り当てに戻ります。これはセッション中だけのプレビューで、設定には書き込みません。パネルの表示は英語か韓国語です(`language` 設定を参照)。日本語環境では英語で表示されます。
- `/tama cast` はプロンプト上の実況バンドを切り替えます。`/tama voice <パック名>` でこのセッションの実況ボイスを変えられます(`default` で戻ります)。
- 外部エージェントは `group` ごとにまとめて表示されます。キャラクター表示では各セクション最大 2 行までなので、全員を見たいときはリスト表示を使ってください。パネルを閉じると、ポーリングとアニメーションは止まります。

標準の割り当ては次のとおりです。

| 役割 | キャラクター ID | モチーフ |
| --- | --- | --- |
| メインエージェント | `slime` | 種を抱えた緑のゼリー |
| サブエージェント | `robot` | 小さな青いロボット |
| 外部エージェント | `mushroom` | 紫のキノコ |
| `queue` を含むグループ(大文字・小文字を区別しない) | `cloud` | ピーチ色の雲 |
| エージェント名が空、`unknown`、または `?` | `meteor` | 尾を引く金色の流れ星 |

## ペットの反応

メインキャラクターはセッションの出来事に反応します。見せるだけで、呼び出しをブロックしたり書き換えたりはしません。

| 出来事 | 反応 | 持続 |
| --- | --- | --- |
| ツール呼び出しがエラーで終わる | `alert` ポーズ、ラベルに `Ouch, failed! <tool>` | 6 秒 |
| 別のプラグインが呼び出しを拒否 | `alert` ポーズ、`Blocked <tool>` | 6 秒 |
| 危険そうな Bash コマンド | `alert` ポーズ、`Danger!`、トースト 1 回 | 8 秒 |
| ターンが回答で終わる | `Done!` | 4 秒 |
| `sleepMinutes` の間静か | `sleep` ポーズ、`zZ` | 次のプロンプトかツール呼び出しまで |

危険コマンドは `rm -rf`、`git push --force`、`git reset --hard`、`DROP TABLE`、`dd if=`、`mkfs` のような取り消しにくいパターンです。`danger` 設定で正規表現を追加できます。呼び出し自体はそのまま実行されます。止めたい場合はガード mod を使ってください。

## 締め切りボス戦

ソースの行に `due` があればボスです。残り時間が体力で、`hits` が増えるたびに一撃入ります。

```json
[
  {"id": "paper", "label": "論文提出", "detail": "要旨の修正",
   "due": "2026-12-01", "since": "2026-11-17", "hits": 12, "group": "締め切り"}
]
```

| フィールド | ルール |
| --- | --- |
| `id`、`label` | 必須 |
| `due` | 必須。ISO の日付か日時、またはミリ秒。日付だけならその日の 23:59:59(ローカル) |
| `since` | 体力が 100% だった時点。省略時は `due` の 14 日前 |
| `hits` | 0 以上の整数。ポーリングの間に増えると `HIT!` が 3 秒光り、実況が入ります |
| `detail`、`group` | 省略可。`group` の既定は `Boss fight` |

ボスの枠には `██████░░░░ 62% · 8d 3h · 12 hits` のような体力行が付きます。24 時間を切ると激怒(`alert` ポーズ、トースト 1 回)、期限を過ぎると `past due` です。ボスのキャラクターは `characters` の `boss` キーで決め、既定は `meteor` です。

## 実況席

プロンプト上のバンドで 2 つの声がセッションを実況します。ターン最初のツール、同じツールの 5・10・20・40 連打、失敗、危険コマンド、ターン終了、サブエージェント投入、外部エージェントの登場と状態変化、ボスへのヒットと激怒、ペットの眠りと目覚めを伝えます。急ぎでなければ 2.5 秒に 1 行まで、同じ言葉は繰り返しません。バンドの **Mute** ボタンか `/tama cast` で切り替えます。

ボイスパックで話し方を変えられます。`~/.local/share/tamagent/voices/<name>.json` に置き、`voices` 設定か `/tama voice <name>` で選びます。

```json
{
  "voices": ["実況", "解説", "新人"],
  "lines": {
    "start": [[0, "{tool} でターン開始。"], [2, "{tool}… 私もやってみます!"]],
    "hit": [[1, "{label} に {hits} ヒット!"]]
  }
}
```

`voices` は 1〜6 名、各行は `[声の番号, 文]` です。`{tool}`、`{count}`、`{seconds}`、`{tools}`、`{description}`、`{agent}`、`{detail}`、`{label}`、`{hits}` が実際の値に置き換わります。種類は `start`、`burst`、`error`、`danger`、`denied`、`turn`、`spawn`、`enter`、`failed`、`waiting`、`hit`、`rage`、`past`、`sleep`、`wake` で、足りない種類は同梱の文を使います。好きな作品のキャラクターの口調でパックを作り、個人フォルダに置いてください。他人のキャラクターを使うパックは公開リポジトリに入れないでください。

## 設定

インストール時か、Tamagent の `/config` 項目で設定します。設定を変えるとエンジンが mod を読み込み直します。設定ファイルでは、値を `pluginConfigs[plugin identifier].options` の下に書きます。`--plugin-dir` の場合、識別子は `tamagent`(または `tamagent@inline`)です。

| userConfig フィールド | 型 | デフォルト | 意味 |
| --- | --- | --- | --- |
| `sources` | string | `"[]"` | **argv 配列の JSON 配列を文字列にしたもの** |
| `refreshSeconds` | number | `5` | ソースのポーリング間隔。1〜3600 秒で、小数も使えます |
| `skin` | string | `"default"` | スキンのフォルダ名。`default` は常に同梱のアートを使います |
| `characters` | string | `""` | `agent=characterID` の組をカンマ区切りで並べたもの |
| `language` | string | `"auto"` | パネルの言語。`auto` は `LC_ALL`、`LC_MESSAGES`、`LANG` を見て、`ko*` なら韓国語、それ以外は英語にします。固定したい場合は `ko` か `en` を指定します |
| `danger` | string | `""` | 同梱の危険コマンド一覧に加える正規表現。ペットが驚くだけで、何もブロックしません |
| `sportscaster` | string | `"on"` | プロンプト上の実況バンド。`off` で隠し、`/tama cast` で表示します |
| `casters` | string | `""` | カンマ区切りの実況者名。ボイスパックの名前を先頭から上書きします |
| `voices` | string | `"default"` | ボイスパック名。`~/.local/share/tamagent/voices/<name>.json` を読みます |
| `sleepMinutes` | number | `10` | ツール呼び出しもプロンプトもないままこの分数が過ぎるとペットが眠ります。1〜1440 |

`options` オブジェクトの例です。パスは自分の環境に合わせて書き換えてください。

```json
{
  "sources": "[[\"python3\",\"/path/to/tamagent/examples/mock-agents.py\"],[\"python3\",\"/path/to/tamagent/examples/process-agents.py\"]]",
  "refreshSeconds": 5,
  "skin": "default",
  "characters": "claude=slime, codex=robot, boss=meteor",
  "casters": "Caster, Color",
  "sleepMinutes": 10
}
```

設定画面の `sources` 入力欄には `[["python3","/path/to/agents.py"]]` をそのまま入力します。コマンドはシェルを通さず、argv のまま実行されます。スペースを含むパスも 1 つの引数として扱われます。`~`、`$HOME`、パイプ、リダイレクトは展開されません。絶対パスか、PATH 上の実行ファイル名を指定してください。コマンドは現在の Claude Code セッションの作業ディレクトリを引き継ぎます。パネルを開いているあいだは繰り返し実行されるので、状態を読み取るだけの信頼できるスクリプトを設定してください。

割り当てはエージェント名で照合し、大文字・小文字は区別しません。 エージェント名に `hermes:fern` のようにコロンがある場合は、完全な名前 → コロンの前の接頭辞(`hermes`)→ 役割の順で探すので、1 つのソースが送る個体ごとに別のキャラクターを割り当てられます。メインエージェントは `claude`、サブエージェントは種類(例: `Explore`)、外部エントリは JSON の `agent` が名前になります。ロールキー `main`、`subagent`、`external`、`queue`、`unknown` を使うと、その役割全体に割り当てられます。エージェント名による割り当てのほうが優先されます。カスタムスキンで割り当てのないエージェントには、マニフェストの最初のキャラクターが使われます。キャラクター ID が見つからない場合は、その役割の同梱キャラクターで代用します。

スキン名とキャラクター ID は ASCII の英字か数字で始まり、英字・数字・`_`・`-` だけを使った 64 文字以内にしてください。設定に誤りがあるとパネルに表示されますが、正しい項目とデフォルトはそのまま動きます。

## 外部エージェントのソース

各コマンドは標準出力に **JSON 配列を 1 つ** 出力して終了する必要があります。診断用のログは標準エラー出力に出してください。個人用の CLI やリモートサービスは必要ありません。

```json
[
  {
    "id": "writer-1",
    "agent": "codex",
    "label": "Writing code",
    "detail": "parser.py",
    "state": "working",
    "group": "Project A"
  }
]
```

| フィールド | 仕様 |
| --- | --- |
| `id` | 必須。空でない文字列で、そのコマンドの結果の中で一意であること |
| `agent` | エージェント名。省略または空の場合は `unknown` |
| `label` | ラベルの 1 行目。デフォルトはエージェント名 |
| `detail` | ラベルの 2 行目。デフォルトは空 |
| `state` | 必須。`working`、`idle`、`stale`、`waiting`、`failed` のいずれか |
| `group` | セクション名。省略または空の場合は既定の **External** セクションに入ります |
| `due` | あるとその行はエージェントではなく **締め切りボス** になります。上のボス戦を参照 |

改行や制御文字は 1 行にまとめられます。余分なフィールドは無視されます。ID はコマンドごとに名前空間が分かれているので、別のコマンドなら同じ ID を使えます。同じ名前のグループは、コマンドをまたいで 1 つにまとまります。コマンドが失敗したり JSON が不正だったりするとエラー行が表示されますが、ほかのソースは表示されたままです。不正な行は 1 行ずつスキップされます。

| 状態 | ポーズ | 見た目 |
| --- | --- | --- |
| `working` | `work` | ツールを使って作業中 |
| `idle` | `idle` | 休憩中。3 フレーム目で目を閉じます |
| `stale` | `sleep` | 寝ている(Zz) |
| `waiting` | `wait` | 黄色の ! |
| `failed` | `alert` | 赤い ! |

ソースは Python の標準ライブラリだけでも書けます。

```python
import json

print(json.dumps([
    {"id": "build", "agent": "codex", "label": "Build",
     "detail": "Running tests", "state": "working", "group": "Development"}
]))
```

[合成データのソース](examples/mock-agents.py)と [ps アダプター](examples/process-agents.py)も参考にしてください。後者は Linux/macOS で現在のユーザーの実行ファイル名を読み取ります。OS のプロセス状態は、実際のエージェントの活動をおおまかに表すだけです。

## キャラクターを差し替える

このリポジトリをダウンロードするか、インストール済みのプラグインディレクトリからヘルパーを実行します。取り込みには Python 3 と、PATH 上の `ffmpeg` と `ffprobe` が必要です。mod を使うだけなら、どちらのツールもいりません。

### キャラクターを探す

Codex デスクトップペット v2 形式(`pet.json` + `spritesheet.png`)で公開されているペットなら、下の手順 1 のコマンド 1 つで取り込めます。

- [Pets Codex](https://petscodex.com) や [Petdex](https://petdex.crafter.run) などのペットカタログ
- GitHub で `codex pet` や `codex desktop pet` を検索する。多くのリポジトリが、リリースにキャラクターごとの ZIP を 1 つずつ公開しています
- [Aseprite](https://www.aseprite.org) や [Piskel](https://www.piskelapp.com) などのピクセルエディターで自分で描き、ポーズごとに PNG フレームを書き出して手順 2 を使う

公開されているペットの多くは、既存キャラクターのファン作品です。各リポジトリの利用条件(たとえば商用利用や再配布の禁止)を読み、その範囲内で個人的に使ってください。

### 1. Codex デスクトップペット v2 を取り込む

```sh
python3 tools/tamagent-skin.py import-codex-pet /path/to/pet-folder --skin my-pets --as a
python3 tools/tamagent-skin.py import-codex-pet /path/to/pet.zip --skin my-pets --as b
python3 tools/tamagent-skin.py import-codex-pet https://example.org/pet.zip --skin my-pets --as c
python3 tools/tamagent-skin.py list
```

フォルダには `pet.json` と `spritesheet.png` が並んで入っている必要があります。ZIP の場合は、この 2 つのファイルが並んだペットがちょうど 1 体だけ入っていなければなりません(フォルダの中にあってもかまいません)。v2 のシートは 192×208px のセルが 8 列 × 11 行並んだもので、全体は 1536×2288px です。空のセルはスキップされます。切り出した各画像は透明な余白を足して 208×208px にし、PNG と 32×32 のカラーグリッドに変換されます。

| 元の行 | セル数 | Tamagent のポーズ |
| --- | --- | --- |
| 0 `idle` | 6 | `idle` |
| 5 `failed` | 8 | `alert` |
| 6 `waiting` | 6 | `sleep` |
| 7 `running` | 6 | `work` |
| 8 `review` | 6 | `wait` |

ペット本来の `waiting` 行は休んでいる様子を表すため、**外部 JSON の `waiting` 状態とは意味が違います**。フレームの長さはデフォルトで 150ms です。`--ms 200` で変更するか、`--gif-dir /path/to/gifs` を指定して、手元の `idle.gif`、`failed.gif`、`waiting.gif`、`running.gif`、`review.gif` からタイミングを読み込めます。元の状態名のファイルがない場合は、ポーズ名の GIF も使えます。GIF のフレーム数がその行のセル数と違う場合、ヘルパーは `--ms` の値を使います。

### 2. 自作の PNG フレームを取り込む

```text
my-character/
  work-0.png
  work-1.png
  idle-0.png
  idle-1.png
  idle-2.png
  idle-3.png
  sleep-0.png
  sleep-1.png
  wait-0.png
  wait-1.png
  alert-0.png
  alert-1.png
  timings.json       # optional
```

背景が透明な正方形の PNG を使ってください。ピクセルアートの原画なら 32×32、画像レンダラー向けなら 128×128 か 208×208 が合います。ヘルパーは元の PNG をバイト単位でそのままコピーし、別に 32×32 のラスターを作ります。正方形でない画像はラスター用に余白が足されますが、画像モードでは 14×7 セルの枠いっぱいに表示されるので、縦横比が崩れることがあります。

ファイル名は `<pose>-<number>.png` とし、ポーズは小文字、番号は整数にします。番号順に並べ替えられます。ポーズごとのフレーム数は 1 以上ならいくつでもかまいません。同梱のアートは work が 2 フレーム、idle が 4 フレーム(3 フレーム目で目を閉じる)、sleep/wait/alert がそれぞれ 2 フレームで、1 フレームあたり 450ms です。

```sh
python3 tools/tamagent-skin.py import-frames /path/to/my-character --skin my-pets --as a --ms 150
```

フレームごとにタイミングを変えたい場合は、元フォルダの `timings.json` にポーズごとの配列を書きます。値は 1〜60000ms で、配列の長さはそのポーズのファイル数と同じにしてください。

```json
{ "idle": [150, 150, 100, 250], "work": [150, 200] }
```

1 枚のスプライトシートからも取り込めます。`--columns` と `--rows` でセルに分け、`--cells` に各ポーズが使うセル番号(左上を 0 として行優先)を書きます。同じポーズを複数回書くと、その順番でアニメーションのフレームになります。セル内の余白が大きいときは `--trim` で描かれた部分だけを切り出し、32×32 に大きく収めます。

```sh
python3 tools/tamagent-skin.py import-sheet /path/to/sheet.png --skin my-pets --as a \
  --columns 3 --rows 2 --cells "idle=0,work=1,idle=2,sleep=3,wait=4,alert=5" --trim --ms 450
```

### 3. スキンと割り当てを設定する

`skin` を `my-pets` に、`characters` を `claude=a, codex=b` に設定します。アセットは実行時のホームディレクトリを基準に `~/.local/share/tamagent/skins/<name>/` に保存されます。`default` は同梱アート用に予約されています。取り込み直すと指定したキャラクターだけが更新され、ほかはそのまま残ります。古い PNG ディレクトリも残るので、使わなくなったらあとで削除できます。

マニフェストの例です(実際のフレームでは `lo` に 1024 個の値が入ります)。

```json
{
  "lo": 32,
  "characters": {
    "a": {
      "idle": [
        { "file": "frames/a/idle-0.png", "lo": [-1, 1193046], "ms": 150 }
      ]
    }
  }
}
```

`lo` は行優先の 32×32 配列で、`-1` は透明、それ以外の整数は `0xRRGGBB` を表します。`file` はマニフェストのフォルダからの相対パスか、絶対パスです。ポーズがない場合やファイルを読めない場合は、そのキャラクターの `idle`、次にその役割の同梱キャラクターで代用します。取り込んだあとは、パネルを閉じて `/tama` で開き直すと新しいファイルが読み込まれます。

マニフェストは、エンジンのテキスト読み込み上限である 4MiB に収まる必要があります。ヘルパーはコンパクトな JSON を書き出し、上限を超えそうな場合はインストール済みのマニフェストをそのまま残して、キャラクターを別のスキンに分けるよう案内します。


### 例: ちいかわたちに切り替える

[chiikawa-dots-pets](https://github.com/heelee912/chiikawa-dots-pets) は、ちいかわのキャラクター 11 体を Codex v2 ペットとしてまとめた非公式のファン作品です。原作キャラクターの権利はナガノ氏およびその他の権利者に帰属し、このリポジトリは商用利用と再配布を認めていません。Tamagent にはこのアートは含まれていません。下のコマンドは、元のリリースからあなたのコンピューターにだけダウンロードします。

```sh
git clone https://github.com/Bum-Boo/tamagent && cd tamagent
for c in chiikawa hachiware usagi kurimanju shisa; do
  python3 tools/tamagent-skin.py import-codex-pet \
    "https://github.com/heelee912/chiikawa-dots-pets/releases/download/v2.0.0/$c.zip" \
    --skin chiikawa --as "$c"
done
python3 tools/tamagent-skin.py list
```

そのあと、Tamagent のオプションを次のように設定します。ほかのキャラクター(モモンガ、ラッコなど)も同じ方法で取り込めます。

| フィールド | 値 |
| --- | --- |
| `skin` | `chiikawa` |
| `characters` | `claude=chiikawa, codex=hachiware, hermes=usagi, subagent=kurimanju, external=kurimanju, queue=shisa, unknown=kurimanju` |

## 著作権

配布物に含まれるのは、Tamagent のために描いたオリジナルのアートだけです。コードと同梱アートは [MIT ライセンス](LICENSE) です。それ以外のキャラクターのアートは、権利者の条件を確認したうえで個人的な範囲でのみ使ってください。取り込んだアートに MIT ライセンスが自動的に適用されることはありません。取り込んだアートはあなたのコンピューターにだけ置かれ、mod に同梱されることも、mod がアップロードすることもありません。URL から取り込む場合は、指定したアドレスから元の ZIP をダウンロードします。

## ターミナルと制限事項

- kitty/Ghostty では、14 列 × 7 行の PNG `Image` 要素を使います。判定には `TERM`、`TERM_PROGRAM`、`KITTY_WINDOW_ID` を見ます。ほかのターミナルでは、半セルのブロック(`▀`、`▄`)で 32 列 × 16 行を描きます。フォントや拡大率、透明ピクセルの下に見えるデフォルトの背景色によって見え方が変わります。
- 画像やラスター要素を表示できない画面(デスクトップ版を含む)や幅の狭いペインでは、リスト表示になります。SSH や tmux を経由すると画像対応が検出できず、ラスターモードになることがあります。リモートホスト上の PNG パスは、ローカルのターミナルから読めない場合があります。
- メインエージェントの `working` は、ツールが実行中であることを表します。モデルが考えている間や応答を生成している間は `idle` として表示されます。外部エージェントの状態がどれだけ正確かは、ソーススクリプト次第です。
- コマンドのタイムアウトは 8 秒、標準出力の上限は 4MiB です。ソースは並行して実行され、前回の更新がまだ終わっていなければ、そのポーリングは 1 回分スキップされます。パネルを開くときは、最初の読み込みが終わるまで待ちます。
- アニメーションは 100ms ごとにフレームのタイミングを確認し、変化したフレームだけを `$.ui.blit` で送ります。短いフレームは飛ばされることがあります。スキンはパネルを開いたときに読み込まれ、ファイルの変更をリアルタイムで監視する機能はありません。
- mod API はアーリーアクセスです。この API がないビルドでは mod を実行できず、API が変わったら改めて動作確認が必要です。Tamagent は状態を表示するだけで、タスクを割り振ったり、作業が終わったかどうかを判断したりはしません。

## 開発とチェック

```sh
python3 tools/make_sprites.py
python3 -m unittest discover -s tests -p 'test_*.py' -v
claude plugin validate .
claude plugin test .
tsc -p . --noEmit
```

対応している Claude Code のビルドでは、開発用フォルダを読み込むと `.claude-plugin/types/` に TypeScript の型宣言が生成されます。`tsc` は、インストール済みの TypeScript のものを使ってください。オリジナルのアートは [tools/make_sprites.py](tools/make_sprites.py) で定義されており、[hooks/characters.ts](hooks/characters.ts) は生成されたファイルです。HD/LO のシートと個別の PNG は `tools/preview/` の下に生成され、Git の管理対象外です。
