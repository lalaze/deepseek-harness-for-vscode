# Changelog

## 0.4.1

- 修复冷会话恢复时 `skills.list` 抢先执行导致的 `session not found (not attached)` 启动异常；可选目录失败不再拖垮整个工作台。
- 对话消息改为按 ID 增量更新，流式文本在原节点内追加；推理和工具卡的展开状态、用户滚动位置不再因新分片丢失。
- 修复斜杠命令传输协议：官方命令改走 `commands/execute`，不再被误发给模型，并在对话中显示持久命令回执。
- 权限选择现在真实写入 `permission/preset`、`sandbox/mode` 与 `approval/policy`，同时保存为本机新会话默认值。

## 0.4.0

- 输入框支持 `/` 斜杠命令菜单：输入 `/` 弹出官方命令列表（`/compact`、`/feedback`、`/goal`、`/permission`、`/plan`），支持过滤、键盘导航与一键插入。
- 新增扩展级斜杠命令 `/model`、`/reasoning`、`/preset`，通过原生快速选择器切换会话模型、推理等级与 Agent Preset。
- 命令列表从运行时 `commands/list` 动态获取，随会话切换刷新。

## 0.3.0

- 移除官方 WebUI iframe，改为原生 VS Code 对话工作台。
- 接入 Harness Gateway RPC、Mux/Host WebSocket 与自动重连。
- 增加会话历史、流式消息、推理、工具、审批、问题、Todo、Skills 和任务视图。
- 模型、推理与 Agent Preset 改为会话级 Gateway 操作。

## 0.2.0

- 改为一个统一的官方 Harness Web 工作台，覆盖完整会话与工具功能。
- 内置 `@deepseek-ai/dsh` 和平台独立 Node，不再要求本地部署、Node 或 npm。
- 增加 Flash/Pro、推理等级和四种官方 Agent Preset 选择器。
- API Key 改为本机 VS Code 用户 `settings.json` 配置，并迁移旧 SecretStorage 值。
- 使用随机回环端口、严格 Webview CSP 和平台目标 VSIX。

## 0.1.0

- 首个 VS Code 扩展版本。
- 通过官方 stdio JSON-RPC SDK 协议连接 DeepSeek Harness。
- 支持侧边栏聊天、流式输出、思考过程、工具活动和多轮会话。
- 支持安全 API Key 存储、托管运行时安装和自定义运行时。
- 支持文件权限策略、停止任务、新建会话和编辑器选区上下文。
