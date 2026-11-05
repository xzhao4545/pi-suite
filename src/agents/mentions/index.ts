// Input dispatch adapted from @tintinweb/pi-subagents 0.23.0 src/index.ts (MIT).
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { SessionBinding } from '../../runtime/binding.ts';
import type { SuiteConfig } from '../../runtime/config.ts';
import type { AgentsModule } from '../index.ts';
import { agentTypes } from '../catalog.ts';
import { isReservedHandle, parseMention, stripAgentPrefix } from './grammar.ts';
import { createMentionProvider, mentionRoster, resolveMentionTarget } from './provider.ts';
import { runMentionClone } from './clone.ts';
import type { registerAgentTools } from '../tools.ts';
import type { AgentType } from '../types.ts';

export function registerAgentMentions(pi: ExtensionAPI, agents: AgentsModule, binding: SessionBinding,
  config: () => SuiteConfig, startTool: ReturnType<typeof registerAgentTools>) {
  const clones = new Set<AbortController>();
  let providerRegistered = false, types: AgentType[] = [];
  const enabled = () => config().agents.mentions;
  const loadTypes = (ctx: Parameters<AgentsModule['scope']>[0], settings = config()) => {
    types = agentTypes(ctx.cwd, undefined, { trusted: ctx.isProjectTrusted(), packageGate: settings.agents.packageAgents, typeSettings: settings.agents.types });
  };
  const roster = () => {
    const current = binding.current;
    return current ? mentionRoster(agents.manager, agents.scope(current.ctx), types) : [];
  };
  const cancel = () => { for (const controller of clones) controller.abort(); clones.clear(); };
  pi.on('session_before_switch', cancel);
  pi.on('session_shutdown', cancel);
  const bind = (ctx: Parameters<AgentsModule['scope']>[0]) => {
    cancel();
    // A session switch retains the host's provider stack; reload replaces the activation.
    // Discover types at bind/dispatch, rather than reading every markdown/package per key.
    loadTypes(ctx);
    if (ctx.mode !== 'tui' || providerRegistered) return;
    providerRegistered = true;
    ctx.ui.addAutocompleteProvider(current => createMentionProvider(current, roster, enabled, error => {
      binding.current?.ctx.ui.notify(`File completion failed: ${String(error)}`, 'error');
      console.error('[pi-suite] autocomplete provider failed', error);
    }));
  };
  pi.on('input', async (event, ctx) => {
    // Print/RPC callers need a normal response; consuming their input would produce silence.
    // Attachments remain on the parent's request because agent_send accepts text only.
    if (!enabled() || event.source !== 'interactive' || ctx.mode !== 'tui') return { action: 'continue' };
    const mention = parseMention(event.text);
    if (!mention) return { action: 'continue' };
    if (isReservedHandle(mention.handle)) return { action: 'transform', text: mention.message, images: event.images };
    if (event.images?.length) return { action: 'continue' };
    loadTypes(ctx);
    const targets = roster(), alias = stripAgentPrefix(mention.handle);
    const target = resolveMentionTarget(targets, mention.handle) ?? (alias ? resolveMentionTarget(targets, alias) : undefined);
    if (!target) return { action: 'continue' };
    if (target.kind === 'record') {
      try {
        const result = await agents.manager.send(target.record.id, mention.message, agents.scope(ctx), config());
        // Mentions have no foreground tool result. Answers to a resumed foreground type
        // or an already-consumed active run must use the ordinary completion notification.
        result.run.notifyResult = true; result.run.consumed = false; agents.manager.changed();
        ctx.ui.notify(`${result.action}: @${target.handle}`, 'info');
      } catch (error) { ctx.ui.notify(`Could not send to @${target.handle}: ${String(error)}`, 'error'); }
      return { action: 'handled' };
    }
    const current = binding.current!, controller = new AbortController();
    clones.add(controller); ctx.ui.notify(`Prompting @${target.handle}…`, 'info');
    // Return control to the editor while the off-screen model writes the task. Cancellation
    // is owned by this activation and fences /new, /tree and reload before any later spawn.
    void runMentionClone(ctx, target.type, mention.message, startTool, controller.signal)
      .catch(error => { if (binding.isCurrent(current) && !controller.signal.aborted) ctx.ui.notify(`Could not start @${target.handle}: ${String(error)}`, 'error'); })
      .finally(() => { clones.delete(controller); });
    return { action: 'handled' };
  });
  return { bind, refreshTypes() { if (binding.current) loadTypes(binding.current.ctx); } };
}
