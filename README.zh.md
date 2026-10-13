# Tamagent

[한국어](README.md) · [English](README.en.md) · [日本語](README.ja.md) · [中文](README.zh.md)

智能体干活的时候，小小的像素伙伴也会跟着动起来。Tamagent 是一个 Claude Code mod，会在面板里显示主智能体和正在运行的子智能体。名字取自 Tamagotchi（拓麻歌子）和 agent。其他工具只要写一个输出 JSON 的脚本就能接进来。

![Tamagent 智能体面板](docs/screenshot-en.png)


## 安装

需要支持函数钩子 mod 的 Claude Code 版本。本仓库基于 2.1.295 版的 API 和测试引擎。在终端版 Claude Code 会话的输入框中输入：

```text
/plugin install tamagent --marketplace Bum-Boo/tamagent
```

出现 `Add marketplace?` 时回答 `y`，选择作用域（个人使用选 `user`），然后完成配置界面即可。默认配置不依赖任何外部工具，mod 会立即生效。如果桌面版的 Code 标签页不支持这条安装命令，请在终端里以 user 作用域安装。

本地开发时运行 `claude --plugin-dir /path/to/tamagent`。

## 使用

```text
/tama
```

- 主智能体在工具调用运行期间处于工作状态，其余时间休息。子智能体在 `running` 时工作，在 `pending`、`waiting` 或 `idle` 时休息，完成后就会消失。
- 顶部的 **Happening now** 跨分区汇总正在动的条目（working、failed、waiting），每项一行。角色视图默认是 **Active only**：休息中的角色折叠为 `N resting`，按 **Show all** 显示全部。
- **List** 切换为文字列表，**Characters** 切换回角色视图。
- 面板文字为英语或韩语（见 `language` 设置），中文环境下显示英语。
- `/tama cast` 切换提示框上方的解说条。`/tama voice <语音包名>` 更换本次会话的解说声音（`default` 恢复默认）。
- 外部智能体按 `group` 分组。角色视图中每个分区最多显示两行，想看全部请切换到列表。关闭面板后会停止轮询和动画。

内置的角色分配：

| 类别 | 角色 ID | 造型 |
| --- | --- | --- |
| 主智能体 | `slime` | 顶着种子的绿色果冻 |
| 子智能体 | `robot` | 蓝色小机器人 |
| 外部智能体 | `mushroom` | 紫色蘑菇 |
| 名称包含 `queue` 的分组（不区分大小写） | `cloud` | 桃色云朵 |
| 智能体名称为空、`unknown` 或 `?` | `meteor` | 拖着尾巴的金色流星 |

## 宠物的反应

主角色会对会话里发生的事做出反应。它只负责展示，不会拦截或改写调用。

| 事件 | 反应 | 持续 |
| --- | --- | --- |
| 工具调用以错误结束 | `alert` 姿势，标签显示 `Ouch, failed! <tool>` | 6 秒 |
| 其他插件拒绝了调用 | `alert` 姿势，`Blocked <tool>` | 6 秒 |
| 看起来危险的 Bash 命令 | `alert` 姿势，`Danger!`，弹一次提示 | 8 秒 |
| 回合以回答结束 | `Done!` | 4 秒 |
| 安静了 `sleepMinutes` 分钟 | `sleep` 姿势，`zZ` | 直到下一次提示或工具调用 |

危险命令指 `rm -rf`、`git push --force`、`git reset --hard`、`DROP TABLE`、`dd if=`、`mkfs` 这类难以撤销的模式。可以用 `danger` 设置添加自己的正则表达式。调用仍会照常执行；想拦截请另外使用守卫类 mod。

## 截止日期 Boss 战

数据源的行里带有 `due` 时，这一行就是 Boss。剩余时间是它的血量，`hits` 每增加一次就是打了它一下。

```json
[
  {"id": "paper", "label": "论文投稿", "detail": "修改摘要",
   "due": "2026-12-01", "since": "2026-11-17", "hits": 12, "group": "截止日期"}
]
```

| 字段 | 规则 |
| --- | --- |
| `id`、`label` | 必填 |
| `due` | 必填。ISO 日期或日期时间，或毫秒数。只写日期表示当天 23:59:59（本地时间） |
| `since` | 血量为 100% 的时刻。省略时为 `due` 前 14 天 |
| `hits` | 大于等于 0 的整数。两次轮询之间增加时，`HIT!` 闪烁 3 秒并触发解说 |
| `detail`、`group` | 可选。`group` 默认为 `Boss fight` |

Boss 格子会带一行血量，例如 `██████░░░░ 62% · 8d 3h · 12 hits`。不足 24 小时时进入狂暴（`alert` 姿势，弹一次提示），过期后显示 `past due`。Boss 角色由 `characters` 的 `boss` 键决定，默认是 `meteor`。

## 解说席

提示框上方的解说条里有两个声音为会话解说：回合的第一个工具、同一工具的第 5、10、20、40 次调用、失败、危险命令、回合结束、子智能体登场、外部智能体进场和状态变化、Boss 受击与狂暴、宠物入睡和醒来。非紧急事件每 2.5 秒最多一行，且不会重复同一句话。用解说条上的 **Mute** 按钮或 `/tama cast` 开关。

语音包可以更换说话风格。放在 `~/.local/share/tamagent/voices/<name>.json`，用 `voices` 设置或 `/tama voice <name>` 选择。

```json
{
  "voices": ["主播", "嘉宾", "新人"],
  "lines": {
    "start": [[0, "{tool} 开启本回合。"], [2, "{tool}… 我也来试试！"]],
    "hit": [[1, "{label} 被击中 {hits} 次！"]]
  }
}
```

`voices` 可以有 1 到 6 个名字，每一行是 `[声音编号, 文本]`。`{tool}`、`{count}`、`{seconds}`、`{tools}`、`{description}`、`{agent}`、`{detail}`、`{label}`、`{hits}` 会被替换成实际值。种类有 `start`、`burst`、`error`、`danger`、`denied`、`turn`、`spawn`、`enter`、`failed`、`waiting`、`hit`、`rage`、`past`、`sleep`、`wake`，缺少的种类使用内置台词。可以用喜欢的作品角色的口吻编写语音包，放在个人文件夹里。使用他人角色的语音包不要放进公开仓库。

## 配置

可以在安装时设置，也可以在 Tamagent 的 `/config` 项中修改。修改配置后，引擎会重新加载 mod。在设置文件中，这些值位于 `pluginConfigs[plugin identifier].options` 下。使用 `--plugin-dir` 时，标识符为 `tamagent`（或 `tamagent@inline`）。

| userConfig 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `sources` | 字符串 | `"[]"` | **编码成字符串的 JSON 数组，数组元素是 argv 数组** |
| `refreshSeconds` | 数字 | `5` | 数据源轮询间隔，1–3600 秒，可以是小数 |
| `skin` | 字符串 | `"default"` | 皮肤文件夹名；`default` 始终使用内置素材 |
| `characters` | 字符串 | `""` | 用逗号分隔的 `agent=characterID` 对 |
| `language` | 字符串 | `"auto"` | 面板语言。`auto` 会检查 `LC_ALL`、`LC_MESSAGES`、`LANG`：`ko*` 时显示韩语，否则显示英语。设为 `ko` 或 `en` 可固定语言 |
| `danger` | 字符串 | `""` | 加入内置危险命令列表的正则表达式。宠物只会受惊，不会拦截任何东西 |
| `sportscaster` | 字符串 | `"on"` | 提示框上方的解说条。`off` 隐藏，`/tama cast` 可打开 |
| `casters` | 字符串 | `""` | 用逗号分隔的解说员名字，从第一个开始覆盖语音包里的名字 |
| `voices` | 字符串 | `"default"` | 语音包名称，从 `~/.local/share/tamagent/voices/<name>.json` 读取 |
| `sleepMinutes` | 数字 | `10` | 没有工具调用和提示的时间超过这个分钟数，宠物就会入睡，1–1440 |

`options` 对象示例，路径请按自己的机器修改：

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

在 `sources` 配置输入框中直接填入 `[["python3","/path/to/agents.py"]]`。命令按 argv 直接执行，不经过 shell。包含空格的路径仍然算作一个参数。`~`、`$HOME`、管道和重定向都不会展开，请使用绝对路径或 PATH 中的可执行文件名。命令继承当前 Claude Code 会话的工作目录。面板打开期间命令会反复执行，所以请只配置可信的、只读取状态的脚本。

映射按智能体名称匹配，不区分大小写：主智能体用 `claude`，子智能体用其类型（例如 `Explore`），外部条目用 JSON 里的 `agent`。 如果智能体名称里带冒号，例如 `hermes:fern`，会依次按完整名称 → 冒号前的前缀（`hermes`）→ 角色查找，这样同一个数据源发来的每个个体都可以有自己的角色。`main`、`subagent`、`external`、`queue`、`unknown` 这几个类别键会作用于整个类别。按智能体名称设置的映射优先。使用自定义皮肤时，没有映射的智能体会用 manifest 中的第一个角色。如果角色 ID 不存在，会回退到该类别的内置角色。

皮肤名和角色 ID 必须以 ASCII 字母或数字开头，只能包含字母、数字、`_` 或 `-`，最长 64 个字符。无效的配置会在面板中提示，有效的条目和默认值照常生效。

## 外部智能体数据源

每条命令都必须向 stdout 输出**一个 JSON 数组**，然后退出。诊断日志请输出到 stderr。不需要任何个人 CLI 或远程服务。

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

| 字段 | 约定 |
| --- | --- |
| `id` | 必填，非空字符串，在该命令的结果中唯一 |
| `agent` | 智能体名称；省略或为空时视为 `unknown` |
| `label` | 标签第一行；默认为智能体名称 |
| `detail` | 标签第二行；默认为空 |
| `state` | 必填：`working`、`idle`、`stale`、`waiting` 或 `failed` |
| `group` | 分区名称；省略或为空时归入默认的 **External** 分区 |
| `due` | 存在时，这一行不是智能体，而是**截止日期 Boss**。见上文 Boss 战 |

换行符和控制字符会被合并成一行。多余的字段会被忽略。ID 按命令划分命名空间，因此不同命令可以使用相同的 ID。同名分组会跨命令合并。某条命令失败或输出的 JSON 无效时，会显示一行错误，其他数据源照常显示。无效的行会被单独跳过。

| 状态 | 姿势 | 表现 |
| --- | --- | --- |
| `working` | `work` | 拿着工具干活 |
| `idle` | `idle` | 休息，第三帧闭眼 |
| `stale` | `sleep` | 睡觉，Zz |
| `waiting` | `wait` | 黄色 ! |
| `failed` | `alert` | 红色 ! |

只用 Python 标准库就能写一个数据源：

```python
import json

print(json.dumps([
    {"id": "build", "agent": "codex", "label": "Build",
     "detail": "Running tests", "state": "working", "group": "Development"}
]))
```

可以参考[模拟数据源](examples/mock-agents.py)和 [ps 适配器](examples/process-agents.py)。后者在 Linux/macOS 上读取当前用户进程的可执行文件名。操作系统的进程状态只能大致反映智能体的实际活动。

## 替换角色

下载本仓库，或者在已安装插件的目录中运行辅助脚本。导入需要 Python 3，并且 PATH 中要有 `ffmpeg` 和 `ffprobe`。使用 mod 本身不需要这两个工具。

### 寻找角色

以 Codex 桌面宠物 v2 格式（`pet.json` + `spritesheet.png`）发布的宠物，用下面第 1 步的一条命令就能导入。

- [Pets Codex](https://petscodex.com)、[Petdex](https://petdex.crafter.run) 等宠物目录
- 在 GitHub 上搜索 `codex pet` 或 `codex desktop pet`；很多仓库会在 releases 中为每个角色单独发布一个 ZIP
- 用 [Aseprite](https://www.aseprite.org)、[Piskel](https://www.piskelapp.com) 等像素画编辑器自己画，按姿势导出 PNG 帧，然后按第 2 步导入

很多公开发布的宠物是已有角色的同人作品。请先阅读各仓库的使用条款（例如禁止商用或二次分发），并在条款允许的范围内仅供个人使用。

### 1. 导入 Codex 桌面宠物 v2

```sh
python3 tools/tamagent-skin.py import-codex-pet /path/to/pet-folder --skin my-pets --as a
python3 tools/tamagent-skin.py import-codex-pet /path/to/pet.zip --skin my-pets --as b
python3 tools/tamagent-skin.py import-codex-pet https://example.org/pet.zip --skin my-pets --as c
python3 tools/tamagent-skin.py list
```

文件夹中必须有 `pet.json`，并且和 `spritesheet.png` 放在一起。ZIP 中必须只包含一个宠物，这两个文件要放在同一层，可以套在一个文件夹里。v2 精灵图为 8 列 × 11 行，每格 192×208px，总尺寸 1536×2288px。空格子会被跳过。每个裁切出来的图像会用透明像素补齐到 208×208px，再转换成 PNG 和 32×32 的颜色网格。

| 源行 | 格数 | Tamagent 姿势 |
| --- | --- | --- |
| 0 `idle` | 6 | `idle` |
| 5 `failed` | 8 | `alert` |
| 6 `waiting` | 6 | `sleep` |
| 7 `running` | 6 | `work` |
| 8 `review` | 6 | `wait` |

宠物原本的 `waiting` 行表示休息，所以**和外部 JSON 中的 `waiting` 状态含义不同**。默认每帧 150ms。可以用 `--ms 200` 修改，也可以用 `--gif-dir /path/to/gifs` 从本地的 `idle.gif`、`failed.gif`、`waiting.gif`、`running.gif`、`review.gif` 读取帧时长。如果没有以源状态命名的文件，也可以用以姿势命名的 GIF。如果 GIF 的帧数和该行的格数不一致，辅助脚本会改用 `--ms`。

### 2. 导入自己的 PNG 帧

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

请使用透明背景的正方形 PNG。像素画原图适合 32×32，图像渲染器适合 128×128 或 208×208。辅助脚本会原样复制 PNG 文件，并另外生成一份 32×32 的栅格图。非正方形图像在生成栅格图时会被补齐，但图像模式会把它拉伸到 14×7 的单元格区域，比例可能会变形。

文件名格式为 `<pose>-<number>.png`，姿势用小写，编号为整数，按数值大小排序。每个姿势的帧数不限，至少一帧即可。内置素材为 work 2 帧、idle 4 帧（第三帧闭眼），sleep/wait/alert 各 2 帧，每帧 450ms。

```sh
python3 tools/tamagent-skin.py import-frames /path/to/my-character --skin my-pets --as a --ms 150
```

如果想逐帧设置时长，在源文件夹的 `timings.json` 中按姿势写入数组。取值范围为 1–60000ms，数组长度必须和对应姿势的文件数一致：

```json
{ "idle": [150, 150, 100, 250], "work": [150, 200] }
```

也可以直接导入一整张精灵图。用 `--columns` 和 `--rows` 切分格子，再在 `--cells` 里写出每个姿势用哪一格（从左上角 0 开始，按行编号）；同一姿势写多次就按顺序成为动画帧。格子里留白很多时，加 `--trim` 只裁出画了内容的部分，让角色在 32×32 里显示得更大。

```sh
python3 tools/tamagent-skin.py import-sheet /path/to/sheet.png --skin my-pets --as a \
  --columns 3 --rows 2 --cells "idle=0,work=1,idle=2,sleep=3,wait=4,alert=5" --trim --ms 450
```

### 3. 配置皮肤和映射

把 `skin` 设为 `my-pets`，`characters` 设为 `claude=a, codex=b`。素材保存在 `~/.local/share/tamagent/skins/<name>/`，这里的主目录以运行时为准。`default` 保留给内置素材。重新导入只会更新指定的角色，其他角色不受影响。旧的 PNG 目录仍然可用，不再使用后可以再清理。

manifest 示例（实际帧中的 `lo` 必须包含 1024 个值）：

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

`lo` 是按行优先排列的 32×32 数组；`-1` 表示透明，其他整数表示 `0xRRGGBB` 颜色。`file` 可以是相对于 manifest 所在文件夹的路径，也可以是绝对路径。如果缺少某个姿势或文件无法读取，会先回退到该角色的 `idle`，再回退到该类别的内置角色。导入后请关闭面板，再用 `/tama` 重新打开，新文件才会加载。

manifest 不能超过引擎 4MiB 的文本读取上限。辅助脚本会写出紧凑的 JSON；如果会超出上限，它会保留已安装的 manifest，并提示你把一部分角色拆到另一个皮肤里。


### 示例：换成吉伊卡哇和它的朋友们

[chiikawa-dots-pets](https://github.com/heelee912/chiikawa-dots-pets) 是一个非官方同人作品，把 11 个吉伊卡哇角色做成了 Codex v2 宠物。原作角色归ナガノ及其他权利人所有，该仓库不允许商用或二次分发。Tamagent 不包含这些美术素材；下面的命令会从原仓库的 releases 下载，并且只下载到你自己的电脑上。

```sh
git clone https://github.com/Bum-Boo/tamagent && cd tamagent
for c in chiikawa hachiware usagi kurimanju shisa; do
  python3 tools/tamagent-skin.py import-codex-pet \
    "https://github.com/heelee912/chiikawa-dots-pets/releases/download/v2.0.0/$c.zip" \
    --skin chiikawa --as "$c"
done
python3 tools/tamagent-skin.py list
```

然后按下表设置 Tamagent 的选项。其他角色（小桃、海獭等）也可以用同样的方法导入。

| 字段 | 值 |
| --- | --- |
| `skin` | `chiikawa` |
| `characters` | `claude=chiikawa, codex=hachiware, hermes=usagi, subagent=kurimanju, external=kurimanju, queue=shisa, unknown=kurimanju` |

## 版权

发布包中只包含为 Tamagent 原创的美术素材。代码和内置素材采用 [MIT 许可证](LICENSE)。其他角色的美术素材请先确认权利人的使用条件，并且仅供个人使用。导入的素材不会因此自动适用 MIT 许可证。这些素材只保存在你的电脑上，mod 既不会打包它们，也不会上传它们。通过 URL 导入时，会从你指定的地址下载源 ZIP。

## 终端与限制

- kitty/Ghostty 使用 14 列 × 7 行的 PNG `Image` 元素，通过 `TERM`、`TERM_PROGRAM` 和 `KITTY_WINDOW_ID` 识别。其他终端使用 32 列 × 16 行的半格字符块（`▀`、`▄`）。字体、缩放比例以及透明像素下面的默认背景色都会影响显示效果。
- 不支持图像或栅格元素的界面（包括桌面版）和比较窄的窗格会显示列表。经过 SSH 或 tmux 时，终端可能检测不到图像支持，从而改用栅格模式。远程主机上的 PNG 路径，本地终端可能读不到。
- 主智能体的 `working` 表示有工具正在运行。模型思考和生成回复时显示为 `idle`。外部状态准不准取决于你的数据源脚本。
- 命令的超时时间为 8 秒，stdout 上限为 4MiB。各数据源并发运行；如果上一次刷新还没结束，这一轮轮询会跳过。打开面板时会等第一次读取完成。
- 动画每 100ms 检查一次帧时长，只通过 `$.ui.blit` 发送有变化的帧。很短的帧可能会被跳过。皮肤在打开面板时加载，不会实时监听文件变化。
- mod API 目前还处于抢先体验阶段。没有这个 API 的版本无法运行本 mod；API 变动后需要重新验证。Tamagent 只负责显示状态，不会分派任务，也不会判断工作是否完成。

## 开发与检查

```sh
python3 tools/make_sprites.py
python3 -m unittest discover -s tests -p 'test_*.py' -v
claude plugin validate .
claude plugin test .
tsc -p . --noEmit
```

受支持的 Claude Code 版本在加载开发文件夹时，会在 `.claude-plugin/types/` 中生成 TypeScript 类型声明。请使用自己安装的 TypeScript 自带的 `tsc`。原创美术素材定义在 [tools/make_sprites.py](tools/make_sprites.py) 中；[hooks/characters.ts](hooks/characters.ts) 是生成出来的文件。HD/LO 精灵表和单独的 PNG 会生成到 `tools/preview/` 下，并且会被 Git 忽略。
