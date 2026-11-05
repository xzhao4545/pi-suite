// Same-process SDK lifecycle adapted from @tintinweb/pi-subagents 0.23.0 src/agent-runner.ts (MIT).
import { createAgentSession, getAgentDir, SessionManager, type ExtensionFactory, type ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { SuiteConfig } from '../runtime/config.ts';
import type { Execution } from './types.ts';
import { AGENT_ENTRY, resultText } from './records.ts';
import { childResources, resourcePath } from './resources/loader.ts';
import { installExtensionToolScope } from './resources/scope.ts';

export async function executeAgent(run: Execution, config: SuiteConfig, factory: ExtensionFactory, changed: () => void): Promise<void> {
  const { record, parent } = run, agentDir = getAgentDir();
  const { settingsManager, loader, scope } = await childResources(run, factory);
  if (run.controller.signal.aborted) return;
  const sessionDir = run.type.sessionDir ?? process.env.PI_CODING_AGENT_SESSION_DIR ?? settingsManager.getSessionDir();
  const manager = run.sessionManager ?? (record.sessionFile ? SessionManager.open(record.sessionFile)
    : record.persisted ? SessionManager.create(record.cwd, sessionDir ? resourcePath(sessionDir, record.cwd) : undefined,
      { parentSession: parent.ctx.sessionManager.getSessionFile() }) : SessionManager.inMemory(record.cwd));
  // Pi 1.5.0 exposes ModelRegistry to extensions but accepts only ModelRuntime in the SDK.
  // Like upstream, bridge this single SDK boundary to retain the parent's providers, auth and
  // virtual routers. Remove the field access when Pi exposes a public context.modelRuntime.
  const modelRuntime = (parent.ctx.modelRegistry as unknown as { runtime: ModelRuntime }).runtime;
  const { session, extensionsResult } = await createAgentSession({ cwd: record.cwd, agentDir, sessionManager: manager,
    settingsManager, resourceLoader: loader, modelRuntime, model: run.model, thinkingLevel: record.thinking,
    excludeTools: run.type.excludeTools });
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
  run.renderers = new Map();
  for (const tool of session.getAllTools()) {
    const renderer = session.extensionRunner.resolveToolRenderers(tool.name, () => session.getToolDefinition(tool.name));
    if (renderer) run.renderers.set(tool.name, renderer);
  }
  run.liveResults = new Map();
  const before = session.getSessionStats();
  let turns = 0;
  const unsubscribe = session.subscribe(event => {
    if (event.type === 'entry_appended' && event.entry.type === 'custom' && event.entry.customType === AGENT_ENTRY) return;
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
    if (event.type === 'tool_execution_start') { record.toolUses = (record.toolUses ?? 0) + 1; record.activity = `tool ${event.toolName}`; }
    if (event.type === 'tool_execution_end') record.activity = 'Generating response';
    if (event.type === 'agent_settled' && event.aborted) run.controller.abort();
    record.lastUpdateAt = new Date().toISOString();
    record.sessionFile = manager.getSessionFile();
    changed();
  });
  const abort = () => { void session.abort(); };
  run.controller.signal.addEventListener('abort', abort, { once: true });
  try {
    if (!run.controller.signal.aborted) {
      record.state = 'running'; changed();
      await session.prompt(`${run.inheritedContext ?? ''}${record.prompt}`, { source: 'extension' });
      for (const message of run.pendingMessages.splice(0)) {
        if (!run.controller.signal.aborted) await session.prompt(message, { source: 'extension' });
      }
    }
    const entries = manager.getBranch(), last = entries.findLast(entry => entry.type === 'message' && entry.message.role === 'assistant');
    record.result = resultText(entries); record.endLeafId = manager.getLeafId();
    const usage = session.getSessionStats(); record.usage = { tokens: Object.fromEntries(Object.entries(usage.tokens)
      .map(([key, value]) => [key, value - before.tokens[key as keyof typeof before.tokens]])) as typeof usage.tokens, cost: usage.cost - before.cost };
    if (last?.type === 'message' && last.message.role === 'assistant' && last.message.stopReason === 'error') errors.push(last.message.errorMessage ?? 'Model request failed');
    if (errors.length) throw new Error(errors.join('; '));
  } finally {
    record.activity = undefined;
    unsubscribe(); run.controller.signal.removeEventListener('abort', abort);
  }
}

export async function closeAgent(run: Execution): Promise<void> {
  const session = run.session;
  if (!session) return;
  try {
    // Shutdown cancels module subscriptions and pending notifications; dispose alone does not.
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
    run.record.sessionFile = session.sessionManager.getSessionFile();
    run.record.endLeafId = session.sessionManager.getLeafId();
    run.record.result ??= resultText(session.sessionManager.getBranch());
    session.sessionManager.appendCustomEntry(AGENT_ENTRY, { ...run.record });
    run.entries = session.sessionManager.getBranch(run.record.endLeafId ?? undefined);
  } finally { session.dispose(); run.session = undefined; }
}
