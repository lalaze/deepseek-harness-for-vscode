# Changelog

## 0.4.3

- 新增 Claude Code 风格的输入框模型配置组件，模型、DSH 模式与推理等级会在发送下一条消息时统一生效。
- 推理等级改为三档可见的胶囊滑杆，支持拖动、滚轮与直接点击，并为不同档位提供独立颜色。
- 模型与模式浮层改为紧凑右对齐布局，同时放大输入区文字并统一工作台圆角风格。
- 模型卡片与输入框右下角的当前模型名称改为完整显示，不再截断为省略号。
- 输入区改为响应式工具、状态与操作分区；窄窗口会自动换行并调整模型面板，Token 左侧不再重复显示模型名称。
- 对话每轮会在最后一个可见结果底部显示工作时长；运行中按秒更新，完成后使用 Harness 的 `turn/start` 与 `turn/end` 事件固定真实耗时。
- 移除图片输入和附件传输，只保留编辑器选区作为显式消息上下文。
- Token 统计旁新增上下文占用圆环，基于 Harness `contextPressure` 投影显示压缩后的实时占用率。
- Agent Preset 在已有对话中切换时自动创建新会话，遵守 Harness 对已启动会话锁定 Preset 的协议约束。
- 修复权限下拉框字段适配和运行时覆盖配置错误；三种官方权限预设现在会完整显示、真实切换当前会话的沙箱与审批策略，并保存为新会话默认值。
- GitHub tag 工作流只构建四个平台 VSIX 并附加到 GitHub Release；不会自动发布到 VS Code Marketplace。
- Marketplace 图标改为透明背景的官方黑色 DeepSeek 标志。
- 使用官方 DeepSeek Harness 图标，并补充相应的第三方资源说明。

## 0.4.2

- 新增英文与简体中文本地化；命令、设置、宿主提示和原生对话工作台会自动跟随 VS Code 显示语言。
- README 改为英文 GitHub 主页，并新增完整的 `README.zh-CN.md` 中文说明。
- 对话正文与推理过程支持 Markdown：标题、列表、引用、代码、表格、删除线和链接均按 VS Code 主题渲染。
- 代码块支持一键复制，http(s) 链接经扩展宿主校验后再交给系统浏览器打开。
- 流式分片继续更新原消息块，Markdown 重排不会替换整条消息，保留展开状态与滚动位置。
- 原始 HTML 默认禁用，渲染结果经过 DOMPurify 白名单净化；远程 Markdown 图片默认禁用，避免不可信内容执行或发起隐私请求。
- 新增编辑器选区自动/手动附加、Token 用量显示及 `Ctrl/Cmd+Alt+H` 工作台快捷键。
- 修复 Windows VSIX 打包与运行时进程树清理，新增 macOS、Linux、Windows 多平台 CI 构建发布。

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
