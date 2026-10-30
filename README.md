# <img src="icons/icon128.png" width="45" align="left" alt=""> Prompt Chain

> 在 ChatGPT、Gemini、DeepSeek 中按顺序发送提示词或提示词链条，快速进入设定的状态...

## 目录说明

- `background/`、`content/`、`shared/`：扩展运行时源码（后台调度、内容脚本桥接、数据模型与存储）。
- `workflow.html` + `sidepanel.js` / `sidepanel.css`、`native-*.js`：本地手写的流程编辑、执行监控与侧边栏衔接界面。
- `assets/`：前端构建产物（React + Vite + Tailwind），不是源码。

## 前端源码在哪里

主界面（侧边栏/弹窗、onboarding、网页内 `$` 面板）的源码在上游 [LangQueue](https://github.com/jerrychen751/LangQueue)，本仓库只保存构建结果：

1. 在上游仓库构建（`npm run build`）。
2. 运行 `python scripts/customize-native.py <上游构建目录>`。脚本会把 `assets/`、`images/` 复制到本仓库，并应用中文化、提示词库和 Prompt Chain 的行为补丁（`native_transport.py`、`native_prompt_sources.py`、`provider_scope.py`）。

因此 `assets/` 下的 JS/CSS 属于生成文件，重新构建会被覆盖：界面行为改动应落在上游源码或 `scripts/customize-native.py` 的补丁里，不要只改产物。

