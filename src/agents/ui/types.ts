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
        model = `${resolved.model.provider}/${resolved.model.id}`; thinking = clampThinkingLevel(resolved.model, resolved.thinking);
        settings = `Model: ${model} (${resolved.modelSource})\nThinking: ${thinking} (${resolved.thinkingSource})`;
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
    const selected = await browse(ctx, dock, { title: 'Subagents · ● enabled / ○ disabled', state: page.state, controls: [page.navigation], items: () => items,
      layout: { truncatePrimary: ({item, maxWidth}) => {
        const row = items.find(row => row.value === item.value)!;
        const name = truncateToWidth(sanitizeText(row.value).replace(/[\r\n\t]/g, ' '), Math.max(1, Math.min(16, Math.floor(maxWidth * 0.35))));
        const tail = ` · ${row.thinking}`;
        // Reserve thinking and enabled state; long model IDs cannot push them out of a row.
        const model = truncateToWidth(sanitizeText(row.modelId).replace(/[\r\n\t]/g, ' '), Math.max(0, maxWidth - visibleWidth(name) - visibleWidth(tail) - 3));
        return `${name} ${row.enabled ? '●' : '○'} ${model}${tail}`;
      } },
      actions: (item, done) => {
        const type = types.find(type => type.name === item.value)!;
        const run = (value: string) => () => { action = value; done(item.value); };
        return [{ label: 'Model / thinking', run: run('model') },
          { label: type.enabled === false ? 'Enable' : 'Disable', run: run(type.enabled === false ? 'enable' : 'disable') },
          { label: 'Use definition', available: () => current.agents.types[type.name]?.enabled !== undefined, run: run('definition') }];
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
