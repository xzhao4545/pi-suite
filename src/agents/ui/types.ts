import { getAgentDir, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { clampThinkingLevel } from '@earendil-works/pi-ai/compat';
import { browse, type BrowsePage } from '../../ui/browser.ts';
import type { Dock } from '../../ui/dock.ts';
import type { SuiteConfig } from '../../runtime/config.ts';
import { agentTypeLocations, writeAgentTypeEnabled } from '../../runtime/config-edit.ts';
import { agentTypes } from '../catalog.ts';
import { resolveSettings } from '../models.ts';
import { editTypeModel } from '../model-editor.ts';
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { sanitizeText } from '../../runtime/text.ts';

export async function showAgentTypes(ctx: ExtensionContext, dock: Dock, config: () => SuiteConfig, reload: (cwd: string) => void, page: BrowsePage): Promise<void> {
  for (;;) {
    const current = config();
    const types = agentTypes(ctx.cwd, getAgentDir(), { trusted: ctx.isProjectTrusted(), packageGate: current.agents.packageAgents, typeSettings: current.agents.types });
    const items = types.map(type => {
      let model = 'unavailable', thinking = 'unavailable', settings: string;
      try {
        const resolved = resolveSettings(ctx, type, { prompt: '' }, current);
        // Inheritance is a runtime choice, not a type default; never preview the parent's live value as a pin.
        model = resolved.modelSource === 'inherited' ? 'not configured' : `${resolved.model.provider}/${resolved.model.id}`;
        thinking = resolved.thinkingSource === 'inherited' ? 'not configured' : clampThinkingLevel(resolved.model, resolved.thinking);
        settings = [`Model: ${model} (${resolved.modelSource})`, `Thinking: ${thinking} (${resolved.thinkingSource})`,
          ...resolved.modelSource === 'inherited' ? ["At runtime, uses the parent session's current model when the run starts."] : [],
          ...resolved.thinkingSource === 'inherited' ? ["At runtime, uses the parent session's current thinking level when the run starts, clamped to the model's capabilities."] : []].join('\n');
      } catch (error) {
        // Invalid model pins remain visible and editable; report the exact failure in details.
        settings = `Configuration error: ${error instanceof Error ? error.message : String(error)}`;
      }
      const locations = agentTypeLocations(ctx.cwd, type.name);
      return { value: type.name, modelId: model.slice(model.indexOf('/') + 1), thinking, enabled: type.enabled !== false,
        label: `${type.name} · ${type.enabled === false ? 'disabled' : 'enabled'} · ${model} · ${thinking}`,
        search: `${type.name} ${type.description} ${model} ${thinking}`, details: () => [type.name, type.description,
          `Enabled: ${type.enabled !== false} (${current.agents.types[type.name]?.enabled === undefined ? 'definition' : 'configuration'})`,
          settings, `Definition: ${type.sourcePath ?? 'built-in'}`, `Model settings: ${locations.model}`, `Thinking settings: ${locations.thinking}`,
          `Tools: ${type.tools?.join(', ') ?? 'inherited'}`, `Excluded tools: ${type.excludeTools?.join(', ') ?? 'none'}`,
          `Allowed subagents: ${Array.isArray(type.allowedSubagents) ? type.allowedSubagents.join(', ') : type.allowedSubagents ?? 'none'}`,
          ...Object.entries({ 'Prompt mode': type.promptMode, 'Max turns': type.maxTurns, 'Persist session': type.persistSession,
            'Session directory': type.sessionDir, 'Run in background': type.runInBackground, 'Inherit context': type.inheritContext,
            Isolated: type.isolated, Memory: type.memory, Extensions: type.extensions, 'Excluded extensions': type.excludeExtensions,
            Skills: type.skills, Color: type.color }).filter(([, value]) => value !== undefined)
            .map(([label, value]) => `${label}: ${Array.isArray(value) ? value.join(', ') : value}`),
          '', type.systemPrompt].join('\n') };
    });
    let action = 'model';
    const selected = await browse(ctx, dock, { title: 'Subagents', state: page.state, pages: page.pages, items: () => items,
      selection: item => ({ name: item.value }),
      layout: { truncatePrimary: ({item, maxWidth}) => {
        const row = items.find(row => row.value === item.value)!;
        const title = sanitizeText(row.value).replace(/[\r\n\t]/g, ' ');
        if (maxWidth < 48 && row.modelId === 'not configured' && row.thinking === 'not configured') {
          // Two identical markers would erase every type name on a phone. M/H explicitly names both fields.
          const suffix = ` ${row.enabled ? '●' : '○'} M/H not configured`;
          return truncateToWidth(title, Math.max(1, maxWidth - visibleWidth(suffix)), '…') + suffix;
        }
        const tail = ` · ${row.thinking}`;
        // Reserve the literal unconfigured markers as well as state; neither field can imply a parent pin.
        const nameRoom = Math.max(1, Math.min(16, Math.floor(maxWidth * 0.35), maxWidth - visibleWidth(tail) - 3 - (row.modelId === 'not configured' ? 14 : 1)));
        const name = truncateToWidth(title, nameRoom, '…');
        // Reserve thinking and enabled state; long model IDs cannot push them out of a row.
        const model = truncateToWidth(sanitizeText(row.modelId).replace(/[\r\n\t]/g, ' '), Math.max(0, maxWidth - visibleWidth(name) - visibleWidth(tail) - 3));
        return `${name} ${row.enabled ? '●' : '○'} ${model}${tail}`;
      } },
      actions: (item, done) => {
        const type = types.find(type => type.name === item.value)!;
        const run = (value: string) => () => { action = value; done(item.value); };
        return [{ key: 'c', label: 'Model / thinking', run: run('model') },
          { key: 'd', label: type.enabled === false ? 'Enable' : 'Disable', run: run(type.enabled === false ? 'enable' : 'disable') },
          { key: 'u', label: 'Use definition', available: () => current.agents.types[type.name]?.enabled !== undefined, run: run('definition') }];
      },
    });
    if (selected === undefined) return;
    const type = types.find(type => type.name === selected)!;
    try {
      if (action === 'model') await editTypeModel(ctx, current, reload, type);
      else {
        try { await writeAgentTypeEnabled(ctx.cwd, type.name, action === 'definition' ? undefined : action === 'enable'); }
        finally { reload(ctx.cwd); }
        ctx.ui.notify(`${type.name}: ${action === 'definition' ? 'using definition' : action === 'enable' ? 'enabled' : 'disabled'} for new executions`);
      }
    } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error'); }
  }
}
