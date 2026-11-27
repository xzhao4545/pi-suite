// Matching/priorities adapted from @tintinweb/pi-subagents 0.23.0 src/model-resolver.ts
// and src/invocation-config.ts (MIT); explicit identities do not use its provider fallback.
import type { ExtensionContext, ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { SuiteConfig } from '../runtime/config.ts';
import { ToolError } from '../runtime/errors.ts';
import type { AgentType, ModelOverrides, ModelSource, StartAgent, ParentContext } from './types.ts';

export function parentModelRuntime(ctx: Pick<ExtensionContext, 'modelRegistry'>): ModelRuntime {
  // Pi 1.5.0 keeps this field private (doc/current/agents/models.md#模型运行时桥接). Check the
  // runtime methods, not class identity: CLI bundles and SDK modules can load different classes.
  // Passing undefined would make createAgentSession silently create an independent runtime.
  const runtime = (ctx.modelRegistry as unknown as { runtime?: ModelRuntime }).runtime;
  if (!runtime || typeof runtime.getModel !== 'function' || typeof runtime.streamSimple !== 'function'
    || typeof runtime.resolveModel !== 'function') {
    throw new ToolError('MODEL_RUNTIME_UNAVAILABLE', 'Pi compatibility error: ModelRegistry.runtime cannot supply the parent model runtime, so child agents and type mentions cannot start; no independent runtime will be created. Run the Pi version this package supports (1.5.0).');
  }
  return runtime;
}

export function resolveModel(ctx: Pick<ExtensionContext, 'modelRegistry'>, name: string, source: string, fuzzy = false) {
  const available = ctx.modelRegistry.getAvailable();
  // A provider prefix is an exact identity; never substitute a same-named model elsewhere.
  const exact = available.filter(model => `${model.provider}/${model.id}` === name || (!name.includes('/') && model.id === name));
  const matches = exact.length ? exact : fuzzy && !name.includes('/') ? available.filter(model => `${model.id} ${model.name}`.toLowerCase().includes(name.toLowerCase())) : [];
  if (matches.length !== 1) throw new ToolError('MODEL_UNAVAILABLE', `${source} specifies ${name}, which matches no authenticated model or more than one. Use an exact provider/modelId that is available.`);
  return matches[0];
}
export function resolveSettings(ctx: ParentContext, type: AgentType, request: StartAgent, config: SuiteConfig, individual?: ModelOverrides) {
  const override = config.agents.types[type.name];
  const modelOptions: [string | undefined, ModelSource, string, boolean][] = [
    [request.model, 'parameter', 'agent_start.model', true],
    [individual?.model, 'individual', `${type.name} individual model`, false],
    [override?.model, 'type', `agents.types.${type.name}.model`, false],
    [type.model, 'frontmatter', `${type.sourcePath ?? type.name}:model`, true],
    [config.agents.defaultModel, 'default', 'agents.defaultModel', false],
  ];
  const selected = modelOptions.find(([value]) => value !== undefined);
  const model = selected ? resolveModel(ctx, selected[0]!, selected[2], selected[3]) : ctx.model;
  if (!model) throw new ToolError('MODEL_UNAVAILABLE', 'Parent session has no model to inherit. Pass model or set agents.defaultModel.');
  const thinkingSource: ModelSource = request.thinking !== undefined ? 'parameter' : individual?.thinking !== undefined ? 'individual' : override?.thinking !== undefined ? 'type' : type.thinking !== undefined ? 'frontmatter' : 'inherited';
  return { model, modelSource: selected?.[1] ?? 'inherited',
    thinking: request.thinking ?? individual?.thinking ?? override?.thinking ?? type.thinking ?? ctx.thinkingLevel ?? 'off', thinkingSource };
}
