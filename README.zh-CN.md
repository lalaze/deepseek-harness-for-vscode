# DeepSeek Harness for VS Code

[English](README.md) | **简体中文**

在 VS Code 中原生运行 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 AI 编码助手扩展。无需克隆上游仓库、安装 Node/npm 或手动部署 Harness；安装匹配平台的 VSIX 即可使用。

> 当前为社区开发版本 `0.4.2`。DeepSeek Harness 仍处于 Developer Preview，本扩展固定使用官方 npm 包 `@deepseek-ai/dsh@0.1.0-rc.6`。

## 功能

- **原生 VS Code 工作台**：全部交互都在侧边栏完成，不嵌套官方 WebUI。
- **完整会话管理**：持久化历史、新建、切换、重命名和分支会话。
- **Markdown 流式回复**：支持标题、列表、表格、引用、代码块、一键复制及安全外链。
- **稳定增量渲染**：流式更新保留推理/工具卡展开状态和用户滚动位置。
- **编辑器选区上下文**：可自动附加当前选中代码，也可用“⬒ 选区”按钮手动插入。
- **斜杠命令**：支持 Harness 官方命令及 `/model`、`/reasoning`、`/preset` 扩展命令。
- **Harness 原生能力**：推理过程、工具调用、审批、结构化问题、Todo、Skills、Goal、Plan 和后台任务。
- **模型与 Agent 设置**：DeepSeek V4 Flash / Pro、`off` / `high` / `max` 推理等级和四种官方 Agent Preset。
- **Token 用量**：在输入区显示当前会话输入和输出 Token。
- **自动本地化**：根据 VS Code 显示语言自动切换英文或简体中文。
- **免部署运行时**：官方 `dsh` 和独立 Node 22.22.3 随平台 VSIX 分发，生命周期由扩展管理。

快捷键：Windows/Linux 使用 `Ctrl+Alt+H`，macOS 使用 `Cmd+Alt+H` 打开工作台。

## 安装

1. 从 [Releases](https://github.com/skymecode/deepseek-harness-for-vscode/releases) 下载与你的平台匹配的 VSIX。
2. 打开 VS Code 扩展面板（`Cmd/Ctrl+Shift+X`）。
3. 点击右上角 `...` → **从 VSIX 安装...**，选择下载的文件。
4. 按提示重新加载 VS Code 窗口。

例如，Apple Silicon Mac 应选择 `darwin-arm64` 包。

## 快速开始

1. 打开要开发的代码项目。
2. 在 VS Code 用户 `settings.json` 中配置 DeepSeek API Key：

   ```json
   {
     "deepseekHarness.apiKey": "sk-你的_DeepSeek_API_Key"
   }
   ```

   也可以运行命令 `DeepSeek Harness: 设置 API Key`，扩展会写入同一个用户设置。

3. 点击 Activity Bar 中的 **DeepSeek Harness** 图标。
4. 在输入框描述任务并发送。

无需执行任何 Harness 安装或启动命令。

## 配置

| 设置 | 默认值 | 说明 |
|---|---|---|
| `deepseekHarness.apiKey` | 空 | DeepSeek API Key，以 `machine` 作用域明文存于用户 `settings.json` |
| `deepseekHarness.model` | `deepseek-v4-flash` | 新会话默认模型 |
| `deepseekHarness.reasoningEffort` | `high` | `off` / `high` / `max` |
| `deepseekHarness.agentPreset` | `standard` | 新会话默认 Agent Preset |
| `deepseekHarness.provider` | `deepseek-official` | Harness 模型提供方路由 |
| `deepseekHarness.baseUrl` | 空 | 可选 API Base URL |
| `deepseekHarness.permissionMode` | `workspace-write` | `read-only` / `workspace-write` / `danger-full-access` |
| `deepseekHarness.autoAttachSelection` | `true` | 发送时自动附加当前编辑器选区 |

API Key 不会写入项目 `.vscode/settings.json`，但会以明文保存在本机用户设置中，请勿提交或分享包含密钥的设置文件。

自动附加的选区最长为 16 KB，超出部分会截断。手动附加同一文件选区后，宿主不会再次自动附加。

## 命令

| 命令 | 说明 |
|---|---|
| `DeepSeek Harness: 打开工作台` | 打开侧边栏工作台 |
| `DeepSeek Harness: 重新加载工作台` | 重启运行时并重新连接 |
| `DeepSeek Harness: 设置 API Key` | 保存 API Key |
| `DeepSeek Harness: 清除 API Key` | 清除 API Key |
| `DeepSeek Harness: 显示日志` | 打开诊断日志 |

## 语言

扩展默认语言为英文，并提供简体中文语言包。命令、设置说明、宿主弹窗和对话工作台都会跟随 VS Code 的显示语言。修改显示语言后执行 **Developer: Reload Window** 即可生效。

## 安全与隐私

- Harness Gateway 只监听 `127.0.0.1` 随机端口。
- Webview 使用严格 CSP，不加载远程脚本或 iframe。
- Markdown 原始 HTML 默认禁用，渲染结果经过 DOMPurify 白名单净化。
- Markdown 远程图片默认禁用；http(s) 外链会先经扩展宿主校验。
- 文件和命令访问由 `permissionMode` 与 Harness 审批策略控制。
- API Key 不发送给 Webview，也不会写入扩展日志。

## 平台支持

扩展 ID 和 Marketplace 产品始终只有一个，但由于内置 Node、PTY 和 sandbox 包含原生二进制，需要分别构建平台 VSIX：

- macOS：`darwin-arm64`、`darwin-x64`
- Linux：`linux-arm64`、`linux-x64`
- Windows：`win32-arm64`、`win32-x64`

当前 GitHub Actions 托管矩阵覆盖 `darwin-arm64`、`linux-arm64`、`linux-x64` 和 `win32-x64`。其他架构需要自托管 runner 或本机打包。

## 开发与打包

```sh
npm install
npm run check-types
npm run lint
npm test
npm run compile
npm run package
```

`npm run package` 会根据当前操作系统和 CPU 架构生成对应 VSIX。`npm ci` 会执行原生依赖所需的生命周期脚本，因此请只在可信提交和锁文件上构建。

项目提交信息统一使用英文。架构与安全边界详见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## 许可证

扩展代码采用 [MIT License](LICENSE)。DeepSeek Harness、Node.js 和其他依赖的许可信息见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) 及各依赖附带的许可证文件。
