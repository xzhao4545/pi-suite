import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { GoalManager } from './manager.ts';
import { goalInstruction } from './context.ts';

export function registerGoalLifecycle(pi: ExtensionAPI, manager: GoalManager): void {
  pi.on('before_agent_start', async (event, ctx) => {
    await manager.beforeStart(event.messageType === 'user');
    // Stop generating the legacy named section. Existing historical system text
    // stays intact; the latest persistent Goal message supersedes its permission.
    delete event.systemPromptOptions.sections['pi-suite-goal'];
    const message = goalInstruction(ctx, manager.goal, manager.contextView(ctx)?.access ?? 'none', manager.control);
    return message ? { message } : undefined;
  });
  pi.on('input', event => { if (event.source !== 'extension') manager.activity.reset(); });
  pi.on('tool_execution_start', (event, ctx) => { if (manager.contextView(ctx)?.access === 'execute') manager.activity.toolStart(event); });
  pi.on('tool_execution_end', (event, ctx) => { if (manager.contextView(ctx)?.access === 'execute') manager.activity.toolEnd(event); });
  pi.on('agent_start', (_event, ctx) => manager.startRun(ctx));
  pi.on('agent_end', event => {
    const message = event.messages.findLast(message => message.role === 'assistant');
    manager.endRun(message?.role === 'assistant' && message.stopReason === 'error' ? message.errorMessage ?? 'Model request failed' : undefined);
  });
  pi.on('message_end', (event, ctx) => manager.messageEnd(event, ctx));
  pi.on('ui_prompt_start', () => manager.userPrompt(true));
  pi.on('ui_prompt_end', () => manager.userPrompt(false));
  pi.on('session_before_compact', () => manager.beforeCompact());
  pi.on('session_compact', async (event, ctx) => {
    await manager.compacted(event.willRetry);
    // Compaction retries and between-tool turns do not re-enter before_agent_start.
    // Pi polls steering before their already-arranged next request. Never steer an
    // idle completed goal or an arranged wait merely to rebuild its description.
    if (event.willRetry || event.reason === 'threshold' && manager.goal?.status === 'active' && !manager.goal.waiting) {
      const access = manager.goal?.status === 'active' && manager.goal.automatic ? 'execute' : manager.contextView(ctx)?.access ?? 'none';
      const message = goalInstruction(ctx, manager.goal, access, manager.control);
      if (message) pi.sendMessage(message, { deliverAs: 'steer' });
    }
  });
  pi.on('session_compact_failed', event => manager.compactFailed(event.errorMessage));
}
