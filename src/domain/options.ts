/** Stable option catalogs mirrored from the official DeepSeek Harness Web UI. */
export const MODEL_OPTIONS = [
  {
    id: 'deepseek-v4-flash',
    label: 'DeepSeek V4 Flash',
    description: '响应更快，适合日常编码与快速迭代。',
  },
  {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    description: '能力更强，适合复杂任务与长链路推理。',
  },
] as const

export const REASONING_OPTIONS = [
  { id: 'off', label: '关闭推理', description: '关闭显式思考。' },
  { id: 'high', label: '高', description: 'Harness 默认推理等级。' },
  { id: 'max', label: '最高', description: '为复杂任务使用最大推理强度。' },
] as const

export const AGENT_PRESET_OPTIONS = [
  {
    id: 'standard',
    label: '标准模式',
    description: '完整编码 Agent，支持常用工具与工作流。',
  },
  {
    id: 'code',
    label: 'PTC 模式',
    description: '通过 Code Mode SDK 组合多步工具操作。',
  },
  {
    id: 'minimal',
    label: '极简模式',
    description: '精简工具集，适合直接的小型编码任务。',
  },
  {
    id: 'cordis',
    label: '创造模式',
    description: '用于检查运行时并创作自定义 Agent Preset。',
  },
] as const

export type ModelId = typeof MODEL_OPTIONS[number]['id']
export type ReasoningEffort = typeof REASONING_OPTIONS[number]['id']
export type AgentPresetId = typeof AGENT_PRESET_OPTIONS[number]['id']

export function modelId(value: string | undefined): ModelId {
  return optionId(MODEL_OPTIONS, value, 'deepseek-v4-flash')
}

export function reasoningEffort(value: string | undefined): ReasoningEffort {
  return optionId(REASONING_OPTIONS, value, 'high')
}

export function agentPresetId(value: string | undefined): AgentPresetId {
  return optionId(AGENT_PRESET_OPTIONS, value, 'standard')
}

function optionId<const Options extends readonly { readonly id: string }[]>(
  options: Options,
  value: string | undefined,
  fallback: Options[number]['id'],
): Options[number]['id'] {
  return options.some((option) => option.id === value) ? value as Options[number]['id'] : fallback
}
