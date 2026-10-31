# Prompt Chain verification

Entry: `verify.cmd` in the project root (Windows). It only orchestrates the existing
suites; the extension and its product code are not modified by a test run.

## Commands

```bat
verify.cmd list
verify.cmd fixtures
verify.cmd fixtures --provider chatgpt
verify.cmd fixtures --provider gemini
verify.cmd fixtures --provider deepseek
verify.cmd fixtures --suite chatgpt.basic
verify.cmd fixtures --suite multi-attachment
verify.cmd fixtures --suite multi-attachment.dom
verify.cmd setup --profile "E:\edge-test-profile"
verify.cmd live --provider chatgpt --profile "E:\edge-test-profile" --allow-send --max-messages 4
```

`fixtures` uses a temporary Edge profile and synthetic pages. `live` requires a
dedicated profile prepared with `setup`, an explicit `--allow-send`, and a message
limit; it refuses the everyday Edge profile.

## Status

PASS: the suite's assertions passed. FAIL: an assertion failed. BLOCKED: environment
or service limits stopped the run. NEEDS_USER: a sign-in, authorization or manual
step is missing. Only PASS exits 0; FAIL exits 1; NEEDS_USER and BLOCKED exit 2.

## Reports

Each run writes `..\.cache\prompt-flow\verification\<stamp>\` with `report.json`,
`report.md`, one directory per suite containing the console log and copied JSON
reports. Suite failures that support screenshots (basic/live) also write PNG files.

## Suites and entry points

The table lists the actual UI entry used by each suite. `workflow page` means the
extension's workflow page Run/Pause/Resume buttons. `native panel` means the real
Edge side panel opened by `native-sidepanel-smoke.py`. Flows are created through
extension storage in most suites; this is not the import UI and is reported as such.

## Boundaries

Fixtures use synthetic pages with instant replies; they do not replace real server
latency, real file processing or real site acceptance. `live` is implemented for the
basic four-step flow but has not been executed in this environment (no authorized
profile); `setup` prepares that profile manually.

## 0.6.3 多附件夹具

`multi-attachment` 验证旧单附件迁移、单步五附件、全部附件的送达回执、ChatGPT/Gemini/DeepSeek 批量上传及逐个附加回退、缺失/冲突停止发送和原附件复用。
`multi-attachment.dom` 使用本地合成 DOM 与 Chromium 检查五个预览卡片、缺失、额外卡片、重复、`(9)` 显示别名和扩展名冲突。**它不会请求真实站点、不会发送用户小说。**
真实三站多附件验收需要用户明确提供独立账号/对话、额度及允许的发送条数，不能由夹具通过推断真实网站现状。

`unit` 中的 ai-chat-exporter 联调依赖位于同级的独立仓库 `ai-chat-exporter`；如未提供则明确列为 SKIP，而非算作已验证。

## 内置自检链条（安装自带）

`tests/fixtures/self-test/` 既是自检夹具，也是扩展安装后自带的那条链条的源文件：

- `自检链条.md`：exporter 格式的链条正文（`## User N` / `## ChatGPT N`），6 步分别是纯文本 → 单附件 → 三附件 → 两附件对照 → 纯文本汇总 → 纯文本收尾。
- `01-阅读范围.md`：单附件步用；带 `ANCHOR-1..4` 标记和 `结束标记：READ-OK-04`，用来核对是否真的读完。
- `02-甲-清单.md`、`03-乙-清单.md`、`04-丙-清单.md`：多附件步用；只有 `03` 提到「银杉」。
- `05-对照-规范.md`、`06-对照-旧稿.md`：对照步用；旧稿里有模糊词、复制上次报告等违规项。

侧边栏首次打开时 `native-ui.js` 会把这条链条连同 6 个附件写进 `langqueue_chains` / `langqueue_attachments`，列表里显示「内置自检 · 提示词与附件」；`pcSelfTestSeeded` 置位后不再重建，删掉就是删掉。`scripts/package.py` 会把该目录打进安装包。

`self-test-chain` 套件（`tests/self-test-chain-smoke.py`）在全新 profile 上验证：6 步、附件按引用入库、重开面板不重复播种。
