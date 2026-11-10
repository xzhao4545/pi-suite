import { renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { encodeTextSignatureV1 } from '@earendil-works/pi-ai/api/responses-signatures';
import { renderLayout, TuiAltScreen, TuiMainScreen } from '@earendil-works/pi-tui';

/** An offline provider inside the actual published host; no replacement UI/extension runner. */
export default function cliHost(pi: ExtensionAPI) {
  const faux = fauxProvider({api: 'cli-faux', provider: 'cli-proof', models: [{id: 'offline'}]});
  const output = Array.from({length: 14}, (_, i) => `CLI_TOOL_LINE_${i}`).join('\n');
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('task_edit', {op: 'add', title: 'CLI_TASK', children: ['CLI_CHILD_TASK']})),
    fauxAssistantMessage(fauxToolCall('agent_start', {prompt: 'CLI_CHILD_REQUEST', background: false})),
    fauxAssistantMessage(fauxToolCall('bash', {command: `printf '${output}\\n'`})),
    fauxAssistantMessage('CLI_CHILD_DONE\n' + 'Child history paragraph\n'.repeat(45)),
    fauxAssistantMessage(fauxToolCall('job_start', {command: "printf 'CLI_STDOUT\\n'; printf 'CLI_STDERR\\n' >&2", name: 'CLI_JOB'})),
    fauxAssistantMessage('CLI_SEED_DONE'),
    fauxAssistantMessage('CLI_JOB_SETTLED'), // A late pipe-job notification can request one continuation.
  ]);
  pi.registerProvider(faux.provider);
  const snapshot = (ctx: ExtensionContext, reason?: string) => {
    // The test reads from another process; publish one complete JSON record atomically.
    const target = join(ctx.cwd, 'cli-state.json');
    writeFileSync(`${target}.next`, JSON.stringify({sessionId: ctx.sessionManager.getSessionId(), sessionFile: ctx.sessionManager.getSessionFile(),
      preparedFork: ctx.sessionManager.supportsPreparedFork === true, layout: typeof renderLayout,
      calls: faux.state.callCount, reason, idle: ctx.isIdle()}));
    renameSync(`${target}.next`, target);
  };
  pi.on('session_start', (event, ctx) => {
    if (event.reason === 'fork') faux.setResponses([fauxAssistantMessage('CLI_FORK_CONTINUE')]);
    snapshot(ctx, event.reason);
  });
  pi.on('agent_settled', (_event, ctx) => snapshot(ctx));
  pi.on('message_end', (event, ctx) => {
    if (event.message.role !== 'assistant') return;
    const id = `${ctx.sessionManager.getSessionId()}_${faux.state.callCount}`;
    // Represent stored Responses state without pretending to validate external decryption.
    return {message: {...event.message, api: 'openai-responses', responseId: `resp_cli_${id}`,
      content: event.message.content.map(block => block.type === 'text'
        ? {...block, textSignature: encodeTextSignatureV1(`msg_cli_${id}`, 'final_answer')} : block)}};
  });
  pi.registerCommand('cli-probe', {description: 'Check the host/extension module identity', handler: async (_args, ctx) => {
    if (ctx.mode === 'tui') await ctx.ui.custom<void>((tui, _theme, _keys, done) => ({
      render: () => [`CLI_NATIVE_IDENTITY_${tui instanceof TuiAltScreen || tui instanceof TuiMainScreen}`],
      invalidate() {}, handleInput: () => done(),
    }), {overlay: true});
    snapshot(ctx);
  }});
}
