import type { Model } from '@earendil-works/pi-ai';
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { clampThinkingLevel } from '@earendil-works/pi-ai/compat';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { SuiteConfig } from '../runtime/config.ts';
import { agentTypeLocations, agentTypeModelAfterClear, writeAgentType } from '../runtime/config-edit.ts';
import { resolveModel, resolveSettings } from './models.ts';
import { agentTypes } from './catalog.ts';
import { active, type AgentType, type ModelOverrides } from './types.ts';
import { ToolError } from '../runtime/errors.ts';
import type { AgentManager } from './manager.ts';
import { selectValue } from '../ui/select.ts';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import type { ViewerNavigation } from '../ui/viewer/navigation.ts';

export async function chooseModelSettings(ctx: ExtensionContext, title: string, initial: ModelOverrides, inherited: () => Model<any> | undefined, navigation?: ViewerNavigation): Promise<ModelOverrides | undefined> {
  const available = ctx.modelRegistry.getAvailable().sort((a, b) => `${a.provider}/${a.id}`.localeCompare(`${b.provider}/${b.id}`));
  // ModelSelector needs the host's private ModelRuntime and cannot represent clearing an
  // override. Reuse the shared native fuzzy picker without changing the main session model.
  const items = [{ value: '', label: 'No override' }, ...available.map(model => ({
    value: `${model.provider}/${model.id}`, label: `${model.provider}/${model.id}`, description: model.name,
  }))];
  const selected = await selectValue(ctx, `${title} · Model`, items, initial.model ?? '', { filter: true, navigation });
  if (selected === undefined) return;
  const model = selected || undefined;
  const effective = model ? resolveModel(ctx, model, title) : inherited();
  const levels = ['', ...effective ? getSupportedThinkingLevels(effective) : ['off' as const]];
  const thinking = await selectValue(ctx, `${title} · Thinking`, levels.map(value => ({ value, label: value || 'No override' })), initial.thinking ?? '', {navigation});
  if (thinking === undefined) return;
  return { model, thinking: thinking ? thinking as ModelOverrides['thinking'] : undefined };
}

export async function editTypeModel(ctx: ExtensionContext, config: SuiteConfig, reload: (cwd: string) => void, selectedType?: AgentType, navigation?: ViewerNavigation): Promise<void> {
  let type = selectedType;
  if (!type) {
    const types = agentTypes(ctx.cwd, getAgentDir(), { trusted: ctx.isProjectTrusted(), packageGate: config.agents.packageAgents });
    const selected = await ctx.ui.select('Select agent type', types.map(type => type.name));
    if (selected === undefined) return;
    type = types.find(type => type.name === selected)!;
  }
  const initial = config.agents.types[type.name] ?? {};
  const locations = agentTypeLocations(ctx.cwd, type.name);
  ctx.ui.notify(`${type.name} · model: ${locations.model}\nthinking: ${locations.thinking}`);
  const fallback = () => resolveSettings(ctx, type, { prompt: '' }, { ...config, agents: { ...config.agents,
    types: { [type.name]: { model: agentTypeModelAfterClear(ctx.cwd, type.name) } } } }).model;
  const changes = await chooseModelSettings(ctx, `${type.name} · model: ${locations.model} · thinking: ${locations.thinking}`, initial, fallback, navigation);
  if (!changes) return;
  try { await writeAgentType(ctx.cwd, type.name, changes); }
  // Model and thinking may live in different files; reload also reflects any field already
  // saved if the other file reports an I/O error. The write error remains visible to the host.
  finally { reload(ctx.cwd); }
  ctx.ui.notify(`${type.name}: model/thinking settings saved for new executions`);
}

export async function updateAgentModel(manager: AgentManager, ctx: ExtensionContext, id: string, changes: ModelOverrides, runId?: string): Promise<void> {
  const { record, run } = manager.get(id, runId);
  // Validate even an idle agent's planned model now, so unavailable selections fail at the edit.
  if (changes.model) resolveModel(ctx, changes.model, `${id} individual model`);
  if (run && active(record.state)) {
    // Clearing an individual override restores this execution's launch choices. Type edits
    // made afterwards must not leak into a running or queued execution through this action.
    const request = { ...run.request,
      model: changes.model === undefined ? run.request.model : undefined,
      thinking: changes.thinking === undefined ? run.request.thinking : undefined };
    const resolved = resolveSettings(run.parent.ctx, run.type, request, run.config, changes);
    const session = run.session;
    if (session) {
      await session.setModel(resolved.model, { persist: false });
      session.setThinkingLevel(resolved.thinking, { persist: false });
      run.record.contextUsage = session.getContextUsage();
    }
    if (!run.settled) Object.assign(run.record, { model: `${resolved.model.provider}/${resolved.model.id}`, modelSource: resolved.modelSource,
      thinking: session?.thinkingLevel ?? resolved.thinking, thinkingSource: resolved.thinkingSource });
    run.model = resolved.model;
  }
  if (run) run.record.individual = changes;
  else manager.restore([{ ...record, individual: changes }]);
  manager.changed();
}

export async function editAgentModel(ctx: ExtensionContext, manager: AgentManager, id: string, config: SuiteConfig, runId?: string, navigation?: ViewerNavigation): Promise<void> {
  const { record, run } = manager.get(id, runId);
  const inherited = () => {
    // Historical records remain editable after disabling their type; admission is enforced
    // by Manager when a new execution starts, not while inspecting the existing contract.
    const type = run?.type ?? agentTypes(ctx.cwd, getAgentDir(), { trusted: ctx.isProjectTrusted(), packageGate: config.agents.packageAgents }).find(type => type.name === record.type);
    if (!type) throw new ToolError('AGENT_TYPE', `Unknown agent type: ${record.type}`);
    return resolveSettings(run?.parent.ctx ?? ctx, type, run?.request ?? { prompt: '' }, run?.config ?? config).model;
  };
  const changes = await chooseModelSettings(ctx, `${id} (${record.runId}) · next request`, record.individual ?? {}, inherited, navigation);
  if (!changes) return;
  // A selector may outlive a resume; bind the write to the run opened, never the agent's latest run.
  await updateAgentModel(manager, ctx, id, changes, record.runId);
  ctx.ui.notify(`${id} (${record.runId}): model/thinking settings applied to its next request`);
}
