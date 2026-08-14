# DeepSeek Harness for VS Code

**English** | [简体中文](README.zh-CN.md)

A native VS Code coding-agent extension powered by [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Install the platform-specific VSIX and start working—there is no upstream repository to clone, no Node/npm setup, and no local Harness deployment to manage.

> This is a community-maintained `0.4.2` release. DeepSeek Harness is currently a Developer Preview, and this extension pins the official `@deepseek-ai/dsh@0.1.0-rc.6` package.

## Features

- **Native VS Code workbench** — all interaction happens in the sidebar; the official WebUI is never embedded.
- **Complete session workflow** — persistent history, create, switch, rename, fork, and resume sessions.
- **Streaming Markdown** — headings, lists, tables, blockquotes, inline formatting, code blocks, copy controls, and safe external links.
- **Stable incremental rendering** — streamed updates preserve disclosure state and the reader's scroll position.
- **Editor selection context** — automatically attach selected code or insert it explicitly with the “⬒ Selection” button.
- **Slash commands** — use official Harness commands plus `/model`, `/reasoning`, and `/preset` extension commands.
- **Harness-native capabilities** — reasoning, tool calls, approvals, structured questions, Todos, Skills, Goals, Plan mode, and background jobs.
- **Model and agent controls** — DeepSeek V4 Flash / Pro, `off` / `high` / `max` reasoning effort, and four official Agent Presets.
- **Token usage** — see current input and output token counts in the composer.
- **Automatic localization** — follows the VS Code display language with English and Simplified Chinese support.
- **Zero-deployment runtime** — official `dsh` and standalone Node 22.22.3 are bundled in each platform VSIX and managed by the extension.

Open the workbench with `Ctrl+Alt+H` on Windows/Linux or `Cmd+Alt+H` on macOS.

## Installation

1. Download the VSIX matching your platform from [Releases](https://github.com/skymecode/deepseek-harness-for-vscode/releases).
2. Open the VS Code Extensions view (`Cmd/Ctrl+Shift+X`).
3. Select `...` → **Install from VSIX...** and choose the downloaded file.
4. Reload the VS Code window when prompted.

For example, an Apple Silicon Mac requires the `darwin-arm64` package.

## Quick start

1. Open the project you want to work on.
2. Add your DeepSeek API Key to the VS Code user `settings.json`:

   ```json
   {
     "deepseekHarness.apiKey": "sk-your_DeepSeek_API_Key"
   }
   ```

   You can also run `DeepSeek Harness: Set API Key`; the extension writes to the same user setting.

3. Select the **DeepSeek Harness** icon in the Activity Bar.
4. Describe your task in the composer and send it.

No Harness install or start command is required.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `deepseekHarness.apiKey` | empty | DeepSeek API Key stored as plain text in user `settings.json` with `machine` scope |
| `deepseekHarness.model` | `deepseek-v4-flash` | Default model for new sessions |
| `deepseekHarness.reasoningEffort` | `high` | `off` / `high` / `max` |
| `deepseekHarness.agentPreset` | `standard` | Default Agent Preset for new sessions |
| `deepseekHarness.provider` | `deepseek-official` | Harness model-provider route |
| `deepseekHarness.baseUrl` | empty | Optional API base URL |
| `deepseekHarness.permissionMode` | `workspace-write` | `read-only` / `workspace-write` / `danger-full-access` |
| `deepseekHarness.autoAttachSelection` | `true` | Automatically attach the active editor selection when sending |

The API Key is never written to project-level `.vscode/settings.json`, but it is stored as plain text in your local user settings. Do not commit or share a settings file containing the key.

Automatically attached selections are limited to 16 KB and are truncated when necessary. If the same file selection is already embedded manually, the host will not attach it again.

## Commands

| Command | Description |
|---|---|
| `DeepSeek Harness: Open Workbench` | Open the sidebar workbench |
| `DeepSeek Harness: Reload Workbench` | Restart the runtime and reconnect |
| `DeepSeek Harness: Set API Key` | Save the API Key |
| `DeepSeek Harness: Clear API Key` | Clear the API Key |
| `DeepSeek Harness: Show Logs` | Open diagnostic logs |

## Localization

English is the default language, and a Simplified Chinese language pack is included. Manifest contributions, settings, extension-host prompts, errors, and the full chat workbench follow the VS Code display language. After changing the display language, run **Developer: Reload Window**.

## Security and privacy

- The Harness Gateway listens only on a random `127.0.0.1` port.
- The Webview uses a strict CSP and loads no remote scripts or iframes.
- Raw Markdown HTML is disabled, and rendered markup is sanitized through a DOMPurify allowlist.
- Remote Markdown images are disabled; http(s) links are validated again by the extension host.
- File and command access is controlled by `permissionMode` and Harness approval policies.
- The API Key is never sent to the Webview or written to extension logs.

## Platform support

There is one extension ID and one Marketplace product. Platform-specific VSIX files are required because the bundled Node, PTY, and sandbox packages contain native binaries:

- macOS: `darwin-arm64`, `darwin-x64`
- Linux: `linux-arm64`, `linux-x64`
- Windows: `win32-arm64`, `win32-x64`

The current hosted GitHub Actions matrix builds `darwin-arm64`, `linux-arm64`, `linux-x64`, and `win32-x64`. Other architectures require a self-hosted runner or local packaging.

## Development and packaging

```sh
npm install
npm run check-types
npm run lint
npm test
npm run compile
npm run package
```

`npm run package` creates a VSIX for the current operating system and CPU architecture. `npm ci` executes lifecycle scripts required by native dependencies, so build only trusted commits and lockfiles.

All project commit messages use English. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the architecture and security boundaries.

## License

Extension code is licensed under the [MIT License](LICENSE). Licensing details for DeepSeek Harness, Node.js, and other dependencies are available in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and the license files shipped with each dependency.
