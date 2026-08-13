# DeepSeek Harness for VS Code

一个自包含的 TypeScript VS Code 扩展，使用原生 Codex/Cline 风格界面调用官方 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。它不嵌套官方 WebUI；安装匹配平台的 VSIX 后，也不需要克隆仓库、安装 Node/npm 或手动部署 Harness。

> 当前是社区开发版本。DeepSeek Harness 仍处于 Developer Preview，扩展固定使用官方 npm 包 `0.1.0-rc.6`。

## 已实现

- 原生 VS Code 会话工作台，无 iframe、无外部 WebUI
- 持久化对话历史、新建/切换/重命名/分支会话
- 多轮输入、运行中排队、停止生成和历史分页
- 流式回复、折叠推理、工具调用/结果时间线
- Harness 审批与结构化用户问题
- Todo 计划、Skills 快捷调用、后台任务状态
- DeepSeek V4 Flash / Pro 与会话级模型切换
- `off`、`high`、`max` 推理等级
- `standard`、`code`（PTC）、`minimal`、`cordis` Agent Preset
- API Key 写入本机 VS Code 用户 `settings.json`
- 官方 `dsh` 与独立 Node 22.22.3 随 VSIX 分发并自动管理生命周期

扩展内部启动 Harness Gateway，只通过本机随机回环端口连接。官方 Web 前端从未加载。

## 使用

1. 安装与系统匹配的 VSIX，例如 macOS Apple Silicon 使用 `darwin-arm64` 包。
2. 打开代码项目。
3. 在 VS Code 用户 `settings.json` 中加入：

   ```json
   {
     "deepseekHarness.apiKey": "你的 DeepSeek API Key"
   }
   ```

4. 点击 Activity Bar 中的 DeepSeek Harness 图标。

也可以点击侧边栏“配置”，扩展会把密钥写入同一个用户设置。无需执行 Harness 安装命令。

## 配置

| 设置 | 默认值 | 说明 |
|---|---|---|
| `deepseekHarness.apiKey` | 空 | 本机 DeepSeek API Key，明文存于用户 `settings.json` |
| `deepseekHarness.model` | `deepseek-v4-flash` | 新会话默认模型，可选 Flash / Pro |
| `deepseekHarness.reasoningEffort` | `high` | 推理等级：`off` / `high` / `max` |
| `deepseekHarness.agentPreset` | `standard` | 新会话默认 Agent Preset |
| `deepseekHarness.provider` | `deepseek-official` | Harness 模型提供方路由 |
| `deepseekHarness.baseUrl` | 空 | 可选 DeepSeek API Base URL |
| `deepseekHarness.permissionMode` | `workspace-write` | 文件与 Shell 权限默认值 |

模型和推理等级会通过 Gateway 更新当前会话；Agent Preset 可更新空白会话，并作为后续新会话默认值。API Key 使用 `machine` 作用域，不会写入项目 `.vscode/settings.json`。它按需求明文存储，请勿提交或同步包含密钥的设置文件。

## 平台与发布

扩展 UI 是跨平台 TypeScript，但内置 Node、PTY 和 sandbox 是原生二进制，所以发布产物按 `darwin-arm64`、`darwin-x64`、`linux-arm64`、`linux-x64`、`win32-arm64`、`win32-x64` 构建。

这仍然是一个扩展。发布到 Marketplace 后只有一个扩展条目，VS Code 会自动安装正确平台包。站外发布时建议在同一个 GitHub Release 放多个 VSIX；用户不需要本地部署 Harness，只需下载与系统匹配的文件。若必须只提供一个站外文件，应改用“首次启动下载并校验平台运行时”的通用启动包。

## 开发与打包

```sh
npm install
npm run check-types
npm run lint
npm test
npm run compile
npm run package
```

详细分层和分发取舍见 `docs/ARCHITECTURE.md`。发布前请把社区占位 `publisher` 改为自己的 Publisher ID，并补充扩展仓库地址。

## License

扩展代码采用 MIT License。打包的 DeepSeek Harness、Node.js 与其他依赖许可见 `THIRD_PARTY_NOTICES.md` 及各 npm 包随附许可文件。
