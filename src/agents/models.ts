// Matching/priorities adapted from @tintinweb/pi-subagents 0.23.0 src/model-resolver.ts
// and src/invocation-config.ts (MIT); explicit identities do not use its provider fallback.
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { SuiteConfig } from '../runtime/config.ts';
import { ToolError } from '../runtime/errors.ts';
import type { AgentType, ModelOverrides, ModelSource, StartAgent, ParentContext } from './types.ts';

export function resolveModel(ctx: Pick<ExtensionContext, 'modelRegistry'>, name: string, source: string, fuzzy = false) {
  const available = ctx.modelRegistry.getAvailable();
  // A provider prefix is an exact identity; never substitute a same-named model elsewhere.
  const exact = available.filter(model => `${model.provider}/${model.id}` === name || (!name.includes('/') && model.id === name));
  const matches = exact.length ? exact : fuzzy && !name.includes('/') ? available.filter(model => `${model.id} ${model.name}`.toLowerCase().includes(name.toLowerCase())) : [];
  if (matches.length !== 1) throw new ToolError('MODEL_UNAVAILABLE', `${source} specifies ${name}: model is unavailable or ambiguous in the authenticated catalogue`);
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
  if (!model) throw new ToolError('MODEL_UNAVAILABLE', 'Parent session has no model to inherit');
  const thinkingSource: ModelSource = request.thinking !== undefined ? 'parameter' : individual?.thinking !== undefined ? 'individual' : override?.thinking !== undefined ? 'type' : type.thinking !== undefined ? 'frontmatter' : 'inherited';
  return { model, modelSource: selected?.[1] ?? 'inherited',
    thinking: request.thinking ?? individual?.thinking ?? override?.thinking ?? type.thinking ?? ctx.thinkingLevel ?? 'off', thinkingSource };
}
