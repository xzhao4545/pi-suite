import { renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { fauxProvider, fauxAssistantMessage, fauxToolCall, type FauxResponseFactory } from '@earendil-works/pi-ai';
import { TuiAltScreen, TuiMainScreen } from '@earendil-works/pi-tui';

/** Offline tools or a local Responses server inside the real, unmodified published host. */
export default function cliHost(pi: ExtensionAPI) {
  const endpoint = process.env.PI_SUITE_TEST_RESPONSES_URL;
  const faux = fauxProvider({api: 'cli-faux', provider: 'cli-proof', models: [{id: 'offline'}]});
  const output = Array.from({length: 14}, (_, i) => `CLI_TOOL_LINE_${i}`).join('\n');
  const toolText = (context: Parameters<FauxResponseFactory>[0]) => {
    const result = context.messages.findLast(message => message.role === 'toolResult');
    return result?.content.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? '';
  };
  const taskGeneration = (context: Parameters<FauxResponseFactory>[0]) => {
    const generation = /^generation: (.+)$/m.exec(toolText(context))?.[1];
    if (!generation) throw new Error('Expected model-visible task generation');
    return generation;
  };
  const goalReply: FauxResponseFactory = context => {
    const sections: Record<string, string | null> = {};
    for (const message of context.messages) if (message.role === 'system') Object.assign(sections, message.sections);
    const contract = sections['pi-suite-goal'] ?? '';
    const match = /(?:Active goal|Goal) ([^:]+):/.exec(contract);
    const goalId = match?.[1];
    if (!goalId) throw new Error(`Expected the actual bound Goal contract: ${JSON.stringify(sections)}`);
    if (match[0].startsWith('Active goal ')) return fauxAssistantMessage(fauxToolCall('goal_wait', {
      goalId, reason: 'CLI controlled external deadline', resumeAfterMs: 60000,
    }));
    const user = context.messages.findLast(message => message.role === 'user');
    const text = user ? typeof user.content === 'string' ? user.content : user.content.filter(block => block.type === 'text').map(block => block.text).join('\n') : '';
    return text.includes('CLI_AUDIT') ? fauxAssistantMessage(fauxToolCall('goal_complete', {goalId, summary: 'CLI completed-work audit'}))
      : fauxAssistantMessage('CLI_STOPPED_MANUAL_INPUT');
  };
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('task_list', {})),
    context => fauxAssistantMessage(fauxToolCall('task_edit', {
      op: 'add', generation: taskGeneration(context), title: 'CLI_TASK', children: ['CLI_CHILD_TASK'],
    })),
    fauxAssistantMessage(fauxToolCall('agent_start', {prompt: 'CLI_CHILD_REQUEST', name: 'CLI_CHILD', background: false})),
    fauxAssistantMessage(fauxToolCall('bash', {command: `printf '${output}\\n'`})),
    fauxAssistantMessage('CLI_CHILD_DONE\n' + 'Child history paragraph\n'.repeat(45)),
    fauxAssistantMessage(fauxToolCall('job_start', {command: "printf 'CLI_STDOUT\\n'; printf 'CLI_STDERR\\n' >&2", name: 'CLI_JOB'})),
    fauxAssistantMessage('CLI_SEED_DONE'),
    fauxAssistantMessage('CLI_JOB_SETTLED'), // A late pipe-job notification can request one continuation.
  ]);
  if (process.env.PI_SUITE_TEST_GOAL_MODE) faux.setResponses([goalReply, goalReply, goalReply, goalReply]);
  if (endpoint) pi.registerProvider('cli-proof', {
    api: 'openai-responses', baseUrl: endpoint, apiKey: 'local-test', models: ['offline', 'other'].map(id => ({id, name: `Local Responses ${id}`,
      reasoning: true, input: ['text' as const], cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}, contextWindow: 32000, maxTokens: 1000})),
  });
  else pi.registerProvider(faux.provider);

  let responses = 0;
  const snapshot = (ctx: ExtensionContext, reason?: string) => {
    // The test reads from another process; publish one complete JSON record atomically.
    const target = join(ctx.cwd, 'cli-state.json');
    writeFileSync(`${target}.next`, JSON.stringify({pid: process.pid, sessionId: ctx.sessionManager.getSessionId(), sessionFile: ctx.sessionManager.getSessionFile(),
      api: ctx.model?.api, calls: endpoint ? responses : faux.state.callCount, reason, idle: ctx.isIdle()}));
    renameSync(`${target}.next`, target);
  };
  pi.on('session_start', (event, ctx) => {
    if (event.reason === 'fork' && !endpoint) faux.setResponses([fauxAssistantMessage('CLI_FORK_CONTINUE')]);
    snapshot(ctx, event.reason);
  });
  pi.on('message_end', event => {if (event.message.role === 'assistant') responses++;});
  pi.on('agent_settled', (_event, ctx) => snapshot(ctx));
  pi.registerCommand('cli-live', {description: 'Hold a real child for native Editor acceptance', handler: async (_args, ctx) => {
    // Completed runs correctly hide Message. Exercise the real active-run permission
    // boundary instead of inventing a control bridge or forcing an inactive Editor.
    const hold: FauxResponseFactory = (context, options) => {
      const live = context.messages.some(message => message.role === 'user' && (typeof message.content === 'string'
        ? message.content.includes('CLI_LIVE') : message.content.some(block => block.type === 'text' && block.text.includes('CLI_LIVE'))));
      if (!live) return fauxAssistantMessage('CLI_PARENT_IDLE');
      const signal = options?.signal;
      if (!signal) throw new Error('Expected SDK child abort signal');
      signal.throwIfAborted();
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('CLI live child aborted')), {once: true}));
    };
    faux.setResponses([hold, hold]); // Child plus a possible late parent job continuation.
    const requestId = 'cli-live';
    const reply = await new Promise<{success: boolean; error?: string}>(resolve => {
      const off = pi.events.on(`subagents:rpc:spawn:reply:${requestId}`, data => {off(); resolve(data as {success: boolean; error?: string});});
      pi.events.emit('subagents:rpc:spawn', {requestId, type: 'general-purpose', prompt: 'CLI_LIVE'});
    });
    if (!reply.success) throw new Error(reply.error);
    snapshot(ctx, 'live');
  }});
  pi.registerCommand('cli-goal-setup', {description: 'Prepare controlled Goal deadline/closure responses', handler: async (_args, ctx) => {
    faux.setResponses([goalReply, goalReply, goalReply, goalReply]);
    snapshot(ctx, 'goal-ready');
  }});
  pi.registerCommand('cli-task-reset', {description: 'Exercise fresh task generations through model tools', handler: async (_args, ctx) => {
    let previous = '', current = '';
    const stale = (context: Parameters<FauxResponseFactory>[0]) => {
      const result = context.messages.findLast(message => message.role === 'toolResult');
      if (!result?.isError || !toolText(context).includes('TASK_STALE')) throw new Error(`Expected stale task rejection: ${toolText(context)}`);
    };
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('task_list', {})),
      context => { previous = taskGeneration(context); return fauxAssistantMessage(fauxToolCall('task_edit', {op: 'done', id: '1.1', generation: previous})); },
      context => {
        current = taskGeneration(context);
        if (current === previous || !toolText(context).includes('tasks cleared')) throw new Error('Expected automatic all-complete clear');
        return fauxAssistantMessage(fauxToolCall('task_edit', {op: 'add', generation: current, title: 'CLI_FRESH_TASK', children: ['CLI_FRESH_TASK_CHILD']}));
      },
      () => fauxAssistantMessage(fauxToolCall('task_get', {id: '1.1', generation: previous})),
      context => { stale(context); return fauxAssistantMessage(fauxToolCall('agent_start', {prompt: 'MUST_NOT_START', taskId: '1.1', taskGeneration: previous})); },
      context => { stale(context); return fauxAssistantMessage(fauxToolCall('job_start', {command: 'echo MUST_NOT_START', taskId: '1.1', taskGeneration: previous})); },
      context => { stale(context); return fauxAssistantMessage(fauxToolCall('task_get', {id: '1.1', generation: current})); },
      context => {
        if (!toolText(context).includes('CLI_FRESH_TASK_CHILD')) throw new Error('Expected fresh child numbered 1.1');
        return fauxAssistantMessage(fauxToolCall('task_edit', {op: 'clear', generation: current}));
      },
      context => {
        if (taskGeneration(context) === current || !toolText(context).includes('tasks cleared')) throw new Error('Expected owner clear');
        return fauxAssistantMessage('CLI_TASK_RESET_DONE');
      },
    ]);
    snapshot(ctx, 'task-reset-ready');
  }});
  pi.registerCommand('cli-probe', {description: 'Check the host/extension module identity', handler: async (_args, ctx) => {
    if (ctx.mode === 'tui') await ctx.ui.custom<void>((tui, _theme, _keys, done) => ({
      render: () => [`CLI_NATIVE_IDENTITY_${tui instanceof TuiAltScreen || tui instanceof TuiMainScreen}`],
      invalidate() {}, handleInput: () => done(),
    }), {overlay: true});
    snapshot(ctx);
  }});
}
