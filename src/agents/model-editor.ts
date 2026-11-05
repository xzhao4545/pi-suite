import type { Model } from '@earendil-works/pi-ai';
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { SuiteConfig } from '../runtime/config.ts';
import { agentTypeLocations, agentTypeModelAfterClear, writeAgentType, writeAgentTypeEnabled } from '../runtime/config-edit.ts';
import { resolveModel, resolveSettings } from './models.ts';
import { agentTypes } from './catalog.ts';
import { active, type AgentType, type ModelOverrides } from './types.ts';
import { ToolError } from '../runtime/errors.ts';
import type { AgentManager } from './manager.ts';
import { selectValue } from '../ui/select.ts';
import { getAgentDir } from '@earendil-works/pi-coding-agent';

export async function chooseModelSettings(ctx: ExtensionContext, title: string, initial: ModelOverrides, inherited: () => Model<any> | undefined): Promise<ModelOverrides | undefined> {
  const available = ctx.modelRegistry.getAvailable().sort((a, b) => `${a.provider}/${a.id}`.localeCompare(`${b.provider}/${b.id}`));
  // ModelSelector requires ModelRuntime and has no "no override" entry. The shared native
  // SelectList retains identities and paging without another private SDK bridge or scoped filter.
  const values = ['', ...available.map(model => `${model.provider}/${model.id}`)];
  const selected = await selectValue(ctx, `${title} · Model`, values.map(value => ({ value, label: value || 'No override' })), initial.model ?? '');
  if (selected === undefined) return;
  const model = selected || undefined;
  const effective = model ? resolveModel(ctx, model, title) : inherited();
  const levels = ['', ...effective ? getSupportedThinkingLevels(effective) : ['off' as const]];
  const thinking = await selectValue(ctx, `${title} · Thinking`, levels.map(value => ({ value, label: value || 'No override' })), initial.thinking ?? '');
  if (thinking === undefined) return;
  return { model, thinking: thinking ? thinking as ModelOverrides['thinking'] : undefined };
}

export async function showAgentTypes(ctx: ExtensionContext, config: SuiteConfig, reload: (cwd: string) => void): Promise<void> {
  const types = agentTypes(ctx.cwd, getAgentDir(), { trusted: ctx.isProjectTrusted(), packageGate: config.agents.packageAgents, typeSettings: config.agents.types });
  const selected = await selectValue(ctx, 'Agent types', types.map(type => ({ value: type.name,
    label: `${type.name} · ${type.enabled === false ? 'disabled' : 'enabled'}` })));
  if (selected === undefined) return;
  const type = types.find(type => type.name === selected)!;
  const override = config.agents.types[type.name]?.enabled;
  const action = await selectValue(ctx, `${type.name} · ${override === undefined ? 'definition' : 'configuration'} · ${type.enabled === false ? 'disabled' : 'enabled'}`, [
    { value: 'enable', label: 'Enable' }, { value: 'disable', label: 'Disable' },
    { value: 'definition', label: 'Use definition' }, { value: 'model', label: 'Model / thinking' },
  ], type.enabled === false ? 'enable' : 'disable');
  if (action === undefined) return;
  if (action === 'model') { await editTypeModel(ctx, config, reload, type); return; }
  try { writeAgentTypeEnabled(ctx.cwd, type.name, action === 'definition' ? undefined : action === 'enable'); }
  finally { reload(ctx.cwd); }
  ctx.ui.notify(`${type.name}: ${action === 'definition' ? 'using definition' : action === 'enable' ? 'enabled' : 'disabled'} for new executions`);
}

export async function editTypeModel(ctx: ExtensionContext, config: SuiteConfig, reload: (cwd: string) => void, selectedType?: AgentType): Promise<void> {
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
  const changes = await chooseModelSettings(ctx, `${type.name} · model: ${locations.model} · thinking: ${locations.thinking}`, initial, fallback);
  if (!changes) return;
  try { writeAgentType(ctx.cwd, type.name, changes); }
  // Model and thinking may live in different files; reload also reflects any field already
  // saved if the other file reports an I/O error. The write error remains visible to the host.
  finally { reload(ctx.cwd); }
  ctx.ui.notify(`${type.name}: model/thinking settings saved for new executions`);
}

export async function updateAgentModel(manager: AgentManager, ctx: ExtensionContext, id: string, changes: ModelOverrides): Promise<void> {
  const { record, run } = manager.get(id);
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
    }
    if (!run.settled) Object.assign(run.record, { model: `${resolved.model.provider}/${resolved.model.id}`, modelSource: resolved.modelSource,
      thinking: session?.thinkingLevel ?? resolved.thinking, thinkingSource: resolved.thinkingSource });
    run.model = resolved.model;
  }
  if (run) run.record.individual = changes;
  else manager.restore([{ ...record, individual: changes }]);
  manager.changed();
}

export async function editAgentModel(ctx: ExtensionContext, manager: AgentManager, id: string, config: SuiteConfig): Promise<void> {
  const { record, run } = manager.get(id);
  const inherited = () => {
    // Historical records remain editable after disabling their type; admission is enforced
    // by Manager when a new execution starts, not while inspecting the existing contract.
    const type = run?.type ?? agentTypes(ctx.cwd, getAgentDir(), { trusted: ctx.isProjectTrusted(), packageGate: config.agents.packageAgents }).find(type => type.name === record.type);
    if (!type) throw new ToolError('AGENT_TYPE', `Unknown agent type: ${record.type}`);
    return resolveSettings(run?.parent.ctx ?? ctx, type, run?.request ?? { prompt: '' }, run?.config ?? config).model;
  };
  const changes = await chooseModelSettings(ctx, `${id} · next request`, record.individual ?? {}, inherited);
  if (!changes) return;
  await updateAgentModel(manager, ctx, id, changes);
  ctx.ui.notify(`${id}: model/thinking settings applied to its next request`);
}
