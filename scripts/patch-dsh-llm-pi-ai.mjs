import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const packageJsonPath = require.resolve('@deepseek-ai/dsh-llm-pi-ai/package.json')
const packageRoot = dirname(packageJsonPath)
const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))

if (packageJson.version !== '0.1.1-rc.1') {
  throw new Error(
    `Unsupported @deepseek-ai/dsh-llm-pi-ai version ${packageJson.version}; `
      + 'review whether the tool replay and connection probing patches are still required.',
  )
}

async function patchFile(relativePath, replacements) {
  const path = join(packageRoot, relativePath)
  let source = await readFile(path, 'utf8')
  let changed = false

  for (const { before, after, label } of replacements) {
    if (source.includes(after)) continue
    const occurrences = source.split(before).length - 1
    if (occurrences !== 1) {
      throw new Error(
        `Cannot apply ${label} to ${relativePath}: expected one matching source block, found ${occurrences}.`,
      )
    }
    source = source.replace(before, after)
    changed = true
  }

  if (changed) await writeFile(path, source, 'utf8')
  return changed
}

const runtimeChanged = await patchFile('lib/index.js', [
  {
    label: 'cross-provider DeepSeek tool replay',
    before: `\t\t\t\tconst context = attachments === void 0 ? toPiContext(options, void 0, onReplayDegrade) : await toPiContext(options, attachments, onReplayDegrade, profile.maxRequestImageBytes);
\t\t\t\tconst iterator = toStreamChunks(snapshot.models.streamSimple(model, context, {`,
    after: `\t\t\t\tconst rawContext = attachments === void 0 ? toPiContext(options, void 0, onReplayDegrade) : await toPiContext(options, attachments, onReplayDegrade, profile.maxRequestImageBytes);
\t\t\t\t// DeepSeek-compatible relays require reasoning_content to be replayed on
\t\t\t\t// every assistant tool call. pi-ai normally strips thinking signatures
\t\t\t\t// when provider ids differ, so normalize only those tool-call messages
\t\t\t\t// to the current DeepSeek wire identity before dispatch.
\t\t\t\tconst context = model.api === "openai-completions" && model.compat?.thinkingFormat === "deepseek" ? {
\t\t\t\t\t...rawContext,
\t\t\t\t\tmessages: rawContext.messages.map((message) => {
\t\t\t\t\t\tif (message.role !== "assistant" || message.provider === model.provider || !message.content.some((block) => block.type === "toolCall")) return message;
\t\t\t\t\t\tconst content = message.content.filter((block) => block.type !== "thinking" || block.redacted !== true).map((block) => {
\t\t\t\t\t\t\tif (block.type === "thinking") return { type: "thinking", thinking: block.thinking, thinkingSignature: "reasoning_content" };
\t\t\t\t\t\t\tif (block.type === "text") return { type: "text", text: block.text };
\t\t\t\t\t\t\treturn { type: "toolCall", id: block.id, name: block.name, arguments: block.arguments };
\t\t\t\t\t\t});
\t\t\t\t\t\tif (!content.some((block) => block.type === "thinking")) content.unshift({ type: "thinking", thinking: "", thinkingSignature: "reasoning_content" });
\t\t\t\t\t\treturn { ...message, api: model.api, provider: model.provider, model: model.id, content };
\t\t\t\t\t})
\t\t\t\t} : rawContext;
\t\t\t\tconst iterator = toStreamChunks(snapshot.models.streamSimple(model, context, {`,
  },
  {
    label: 'explicit endpoint connection probe',
    before: `\tif (request.provider !== void 0) {
\t\tconst installed = catalogModels(request.provider);`,
    after: `\t// A provider-only discovery is a catalog lookup. Supplying baseURL is an
\t// explicit connection probe: reach the endpoint and let storedApiKey resolve
\t// the route's write-only credential instead of returning a cached catalog.
\tif (request.provider !== void 0 && request.baseURL === void 0) {
\t\tconst installed = catalogModels(request.provider);`,
  },
])

if (runtimeChanged) {
  process.stdout.write('Patched @deepseek-ai/dsh-llm-pi-ai tool replay and connection probing.\n')
}
