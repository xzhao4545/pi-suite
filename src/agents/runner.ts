// Same-process SDK lifecycle adapted from @tintinweb/pi-subagents 0.23.0 src/agent-runner.ts (MIT).
import { createAgentSession, getAgentDir, SessionManager, type ExtensionFactory } from '@earendil-works/pi-coding-agent';
import type { AgentEventKind, Execution } from './types.ts';
import { AGENT_ENTRY, resultText } from './records.ts';
import { childResources } from './resources/loader.ts';
import { resourcePath } from './resources/paths.ts';
import { installExtensionToolScope } from './resources/scope.ts';
import { createStructuredCapture, createStructuredOutputTool, structuredRetryPrompt } from './output/tool.ts';
import { sanitizeText } from '../runtime/text.ts';
import { createChildSession } from './session.ts';
import { parentModelRuntime } from './models.ts';
import { ModelRequestError } from './retry.ts';

export async function executeAgent(run: Execution, factory: ExtensionFactory, changed: () => void,
  emitEvent: (kind: AgentEventKind, details?: Record<string, unknown>) => void): Promise<void> {
  const { record, parent } = run, agentDir = getAgentDir();
  // Queued runs can survive reload. Check the registry captured at launch before loading resources.
  const modelRuntime = parentModelRuntime(parent.ctx);
  const { settingsManager, loader, scope } = await childResources(run, factory);
  if (run.controller.signal.aborted) return;
  const manager = run.sessionManager ?? (record.sessionFile ? SessionManager.open(record.sessionFile)
    : record.persisted ? createChildSession(record.cwd, parent.ctx.sessionManager.getSessionFile(),
      run.type.sessionDir === undefined ? undefined : resourcePath(run.type.sessionDir, record.cwd)) : SessionManager.inMemory(record.cwd));
  const capture = createStructuredCapture();
  const { session, extensionsResult } = await createAgentSession({ cwd: record.cwd, agentDir, sessionManager: manager,
    settingsManager, resourceLoader: loader, modelRuntime, model: run.model, thinkingLevel: record.thinking,
    excludeTools: run.type.excludeTools,
    customTools: run.options.structuredOutput ? [createStructuredOutputTool(run.options.structuredOutput, capture)] : undefined });
  run.session = session; run.sessionManager = manager; record.sessionFile = manager.getSessionFile();
  // Creation awaits SDK/resource startup. An individual edit accepted during that await must
  // reach the first request even when the SDK was initially constructed with the earlier value.
  if (session.model?.provider !== run.model.provider || session.model?.id !== run.model.id) await session.setModel(run.model, { persist: false });
  session.setThinkingLevel(record.thinking, { persist: false });
  record.thinking = session.thinkingLevel;
  session.setSessionName(`${record.name} · ${record.id}`);
  const errors: string[] = extensionsResult.errors.map(error => `${error.path}: ${error.error}`);
  await session.bindExtensions({ mode: 'print', onError: error => { errors.push(error.error); } });
  if (errors.length) throw new Error(errors.join('; '));
  installExtensionToolScope(session, scope);
  const extensionRunner = session.extensionRunner;
  run.renderers = new Map();
  for (const tool of session.getAllTools()) {
    const renderer = extensionRunner.resolveToolRenderers(tool.name, () => session.getToolDefinition(tool.name));
    if (renderer) run.renderers.set(tool.name, renderer);
  }
  // Retained transcripts can still resolve the child's extensions after the session closes.
  run.customRenderers = {
    getMessageRenderer: extensionRunner.getMessageRenderer.bind(extensionRunner),
    getEntryRenderer: extensionRunner.getEntryRenderer.bind(extensionRunner),
  };
  run.liveResults = new Map();
  const before = session.getSessionStats();
  const updateUsage = () => {
    const usage = session.getSessionStats(); record.usage = { tokens: Object.fromEntries(Object.entries(usage.tokens)
      .map(([key, value]) => [key, value - before.tokens[key as keyof typeof before.tokens]])) as typeof usage.tokens, cost: usage.cost - before.cost };
    record.contextUsage = usage.contextUsage;
  };
  const inflight = new Map<string, string>();
  let turns = 0;
  const unsubscribe = session.subscribe(event => {
    if (event.type === 'entry_appended' && event.entry.type === 'custom' && event.entry.customType === AGENT_ENTRY) return;
    // SDK message_end precedes persistence and ordinary messages emit no entry_appended.
    // Tool start and turn end run after persistence, so stats include billed messages.
    if (event.type === 'tool_execution_start' || event.type === 'turn_end' || event.type === 'entry_appended'
      && (event.entry.type === 'usage' || (event.entry.type === 'compaction' || event.entry.type === 'branch_summary') && event.entry.usage)) updateUsage();
    if (event.type === 'message_update') run.streamingEntry = { type: 'message', id: `stream:${record.runId}`, parentId: manager.getLeafId(), timestamp: new Date(event.message.timestamp).toISOString(), message: event.message };
    else if (event.type === 'message_end') run.streamingEntry = undefined;
    if (event.type === 'tool_execution_update') run.liveResults!.set(event.toolCallId, { type: 'message', id: `stream:${event.toolCallId}`, parentId: manager.getLeafId(), timestamp: new Date().toISOString(),
      message: { role: 'toolResult', toolCallId: event.toolCallId, toolName: event.toolName, ...event.partialResult, isError: false, timestamp: Date.now() } });
    else if (event.type === 'tool_execution_end') run.liveResults!.delete(event.toolCallId);
    if (event.type === 'turn_start') {
      turns++;
      record.turns = turns; record.activity = 'Generating response';
      if (run.maxTurns && turns > run.maxTurns) { record.state = 'limited'; run.controller.abort(); }
    }
    if (event.type === 'tool_execution_start') {
      record.toolUses = (record.toolUses ?? 0) + 1;
      const args = sanitizeText(JSON.stringify(event.args)).replace(/\s+/g, ' ');
      inflight.set(event.toolCallId, `tool ${event.toolName} ${args.length > 180 ? `${args.slice(0, 177)}...` : args}`);
    }
    if (event.type === 'tool_execution_end') inflight.delete(event.toolCallId);
    // Concurrent calls end independently; one completed call must not hide the others.
    if (event.type === 'tool_execution_start' || event.type === 'tool_execution_end') record.activity = [...inflight.values()].join(' · ') || 'Generating response';
    if (event.type === 'agent_settled' && event.aborted) run.controller.abort();
    if (event.type === 'message_end' && event.message.role === 'assistant') emitEvent('usage', { usage: event.message.usage });
    if (event.type === 'compaction_end' && event.result && !event.aborted) {
      updateUsage();
      record.compactionCount = (record.compactionCount ?? 0) + 1;
      const info = { reason: event.reason, tokensBefore: event.result.tokensBefore, compactionCount: record.compactionCount };
      run.options.onCompaction?.(info); emitEvent('compacted', info);
    }
    record.lastUpdateAt = new Date().toISOString();
    record.sessionFile = manager.getSessionFile();
    changed();
  });
  const abort = () => { void session.abort(); };
  run.controller.signal.addEventListener('abort', abort, { once: true });
  let requestError: string | undefined;
  const prompt = async (message: string) => {
    await session.prompt(message, { source: 'extension' });
    const last = manager.getBranch().findLast(entry => entry.type === 'message' && entry.message.role === 'assistant');
    if (last?.type === 'message' && last.message.role === 'assistant' && last.message.stopReason === 'error') {
      requestError = last.message.errorMessage ?? 'Model request failed. Check the configured model and provider before retrying.';
    }
  };
  try {
    if (!run.controller.signal.aborted) {
      record.state = 'running'; emitEvent('started'); changed();
      await prompt(`${run.inheritedContext ?? ''}${record.prompt}`);
      // Leave unsubmitted messages on the run so its replacement can still deliver them.
      while (requestError === undefined && !run.controller.signal.aborted && run.pendingMessages.length) await prompt(run.pendingMessages.shift()!);
      // The SDK cannot force a tool call; prompt once more rather than treating prose as structured output.
      if (requestError === undefined && run.options.structuredOutput && !capture.json && !run.controller.signal.aborted) {
        record.structuredRetried = true;
        await prompt(structuredRetryPrompt(capture));
      }
    }
    const entries = manager.getBranch();
    record.result = resultText(entries); record.endLeafId = manager.getLeafId();
    updateUsage();
    if (requestError !== undefined) throw new ModelRequestError(requestError, settingsManager.getRetrySettings(), errors);
    if (run.options.structuredOutput && !run.controller.signal.aborted) {
      if (capture.json === undefined) errors.push(capture.lastError ?? 'Agent did not report StructuredOutput. Retry with a task that asks it to call StructuredOutput.');
      else { record.structuredJson = capture.json; record.result = capture.json; }
    }
    if (errors.length) throw new Error(errors.join('; '));
  } finally {
    record.activity = undefined;
    unsubscribe(); run.controller.signal.removeEventListener('abort', abort);
  }
}
