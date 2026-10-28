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
