// Conversation cloning adapted from @tintinweb/pi-subagents 0.23.0 src/mention-clone.ts
// (MIT). Only the registered start tool runs, attributed to the real parent context.
import { createAgentSession, DefaultResourceLoader, getAgentDir, SessionManager, SettingsManager,
  type ExtensionContext, type ExtensionToolContext, type ModelRuntime, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { agentMentionReminder } from './grammar.ts';
import type { registerAgentTools } from '../tools.ts';

export async function runMentionClone(ctx: ExtensionContext, type: string, message: string, agentTool: ReturnType<typeof registerAgentTools>,
  signal: AbortSignal): Promise<void> {
  // Capture the selected branch/prompt before any asynchronous setup; /tree and /new
  // can change the parent's read-only session manager while the copy is being built.
  const entries = ctx.sessionManager.getBranch(), systemPrompt = ctx.getSystemPrompt(), model = ctx.model, thinkingLevel = ctx.thinkingLevel;
  const settingsManager = SettingsManager.create(ctx.cwd, getAgentDir(), { projectTrusted: ctx.isProjectTrusted() });
  const cloneSchema = Type.Object({ prompt: Type.String({ minLength: 1 }) }, { additionalProperties: false });
  let attempted = false, spawned = false;
  let launchError: unknown;
  const cloneTool: ToolDefinition<typeof cloneSchema> = { ...agentTool,
    // A clone has one job. Other start options belong to explicit user/model launches.
    parameters: cloneSchema,
    execute: async (_id, params, toolSignal, update) => {
      signal.throwIfAborted();
      if (attempted) throw new Error('Already attempted to start this mentioned agent');
      attempted = true;
      try {
        const result = await agentTool.execute(undefined as never, { prompt: params.prompt, type, background: true },
          toolSignal, update, ctx as ExtensionToolContext);
        spawned = true;
        return result;
      } catch (error) { launchError = error; throw error; }
    },
  };
  const loader = new DefaultResourceLoader({ cwd: ctx.cwd, agentDir: getAgentDir(), settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    systemPromptOverride: () => systemPrompt, appendSystemPromptOverride: () => [],
  });
  await loader.reload(); signal.throwIfAborted();
  // Pi extensions expose ModelRegistry, while createAgentSession accepts ModelRuntime.
  // This is the same single-version bridge used by the ordinary child runner.
  const modelRuntime = (ctx.modelRegistry as unknown as { runtime: ModelRuntime }).runtime;
  const { session } = await createAgentSession({ cwd: ctx.cwd, agentDir: getAgentDir(), settingsManager,
    sessionManager: SessionManager.inMemory(ctx.cwd, undefined, entries), resourceLoader: loader,
    modelRuntime, model, thinkingLevel, tools: [cloneTool.name], customTools: [cloneTool] });
  const abort = () => { void session.abort(); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    await session.prompt(`${message}\n\n${agentMentionReminder(type)}`, { source: 'extension' });
    signal.throwIfAborted();
    if (!spawned) throw launchError ?? new Error('The conversation clone did not start the mentioned agent');
  } finally { signal.removeEventListener('abort', abort); session.dispose(); }
}
