import type { AgentSession, ExtensionContext, SessionEntry, SessionManager, SessionStats, ToolRenderers } from '@earendil-works/pi-coding-agent';
import type { Model } from '@earendil-works/pi-ai';
import type { AskParams, AskResult, Question } from '../ask/schema.ts';
import type { TaskStore } from '../tasks/store.ts';
import type { SuiteConfig } from '../runtime/config.ts';
import type { CompiledSchema } from './output/schema.ts';
export type ResourceChoice = boolean | string[];
export type MemoryScope = 'user' | 'project' | 'local';

export type Thinking = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type AgentState = 'queued' | 'starting' | 'running' | 'waiting' | 'stopping' | 'completed' | 'failed' | 'stopped' | 'limited';
export const active = (state: AgentState): boolean => ['queued', 'starting', 'running', 'waiting', 'stopping'].includes(state);
export const executing = (state: AgentState): boolean => state !== 'queued' && active(state);
export type Pool = 'background' | 'foreground';
export interface AgentType {
  name: string; displayName?: string; description: string; systemPrompt: string; promptMode: 'append' | 'replace';
  tools?: string[]; excludeTools?: string[]; model?: string; thinking?: Thinking;
  maxTurns?: number; persistSession?: boolean; allowedSubagents?: 'all' | string[];
  enabled?: boolean; sourcePath?: string; packageName?: string; color?: string;
  extensions?: ResourceChoice; excludeExtensions?: string[]; skills?: ResourceChoice;
  sessionDir?: string; inheritContext?: boolean; runInBackground?: boolean; isolated?: boolean; memory?: MemoryScope;
}
export type ModelSource = 'parameter' | 'type' | 'frontmatter' | 'default' | 'inherited' | 'individual';
export type ModelOverrides = { model?: string; thinking?: Thinking };
export interface AgentRecord {
  version: 1; id: string; runId: string; type: string; name: string; prompt: string; cwd: string; configCwd?: string;
  ownerSessionId: string; anchorEntryId: string | null; parentAgentId?: string; parentRunId?: string;
  ancestors: string[]; background: boolean; state: AgentState;
  createdAt: string; startedAt?: string; endedAt?: string; elapsedMs?: number;
  model: string; modelSource: ModelSource; thinking: Thinking; thinkingSource: ModelSource;
  sessionFile?: string; endLeafId?: string | null; persisted: boolean;
  result?: string; error?: string; usage?: Pick<SessionStats, 'tokens' | 'cost'>;
  taskId?: string; handle?: string; alias?: string; scheduleId?: string; workflowId?: string; description?: string;
  structuredJson?: string; structuredRetried?: boolean; compactionCount?: number;
  turns?: number; toolUses?: number; activity?: string; lastUpdateAt?: string;
  individual?: ModelOverrides;
}
export type StartAgent = {
  type?: string; prompt: string; name?: string; background?: boolean; model?: string; thinking?: Thinking;
  maxTurns?: number; taskId?: string; inheritContext?: boolean; isolated?: boolean;
};
export interface ParentScope {
  ctx: ExtensionContext; run?: Execution; taskStore?: TaskStore;
}
export const isTopLevelAgent = (record: Pick<AgentRecord, 'parentAgentId' | 'workflowId'>): boolean =>
  record.parentAgentId === undefined && record.workflowId === undefined;
export const recordWorkspace = (record: AgentRecord): string => record.configCwd ?? record.cwd;
export type AgentEventKind = 'created' | 'started' | 'completed' | 'failed' | 'steered' | 'compacted' | 'usage';
export type StartOptions = {
  scheduleId?: string; workflowId?: string; bypassQueue?: boolean; signal?: AbortSignal;
  cwd?: string; description?: string; structuredOutput?: CompiledSchema; detached?: boolean;
  onSpawned?: (id: string) => void; onQueued?: (id: string, ahead: number) => void;
  onCompaction?: (info: { reason: string; tokensBefore: number; compactionCount: number }) => void;
};
export type PendingQuestion = {
  params: AskParams; questions: Question[]; seen: boolean; finish: (result: AskResult) => void;
};
/** Runtime handles belong to one run, never to the stable agent ID. */
export interface Execution {
  record: AgentRecord; type: AgentType; model: Model<any>; parent: ParentScope;
  controller: AbortController; done: PromiseWithResolvers<AgentRecord>; chargedPool?: Pool;
  startedMonotonic?: number; session?: AgentSession; sessionManager?: SessionManager; entries?: SessionEntry[]; question?: PendingQuestion;
  settled?: boolean; terminated?: boolean; streamingEntry?: SessionEntry;
  liveResults?: Map<string, SessionEntry>; renderers?: Map<string, ToolRenderers>;
  pendingMessages: string[]; consumed: boolean; notifyResult?: boolean; maxTurns?: number;
  request: StartAgent; config: SuiteConfig; isolated?: boolean; inheritedContext?: string; bypassQueue?: boolean;
  configCwd: string; configTrusted: boolean; options: StartOptions; startup?: PromiseWithResolvers<string | undefined>; detachAbort?: () => void;
}
