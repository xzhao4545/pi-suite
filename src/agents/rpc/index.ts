// Session gating/lifecycle adapted from @tintinweb/pi-subagents 0.23.0 src/index.ts (MIT).
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { SessionBinding } from '../../runtime/binding.ts';
import type { SuiteConfig } from '../../runtime/config.ts';
import type { AgentsModule } from '../index.ts';
import { active, isTopLevelAgent, type AgentRecord } from '../types.ts';
import { registerRpcHandlers } from './handlers.ts';
import { normalizeSpawn } from './options.ts';

const statusOf = (record: AgentRecord) => record.state === 'completed' ? 'completed' : record.state === 'failed' ? 'error'
  : record.state === 'limited' ? 'aborted' : record.state === 'queued' ? 'queued' : record.state === 'stopped' ? 'stopped' : 'running';

export class AgentRpc {
  private unsubscribe?: () => void;
  constructor(private pi: ExtensionAPI, private binding: SessionBinding, private agents: AgentsModule, private config: () => SuiteConfig) {}
  bind(): void {
    if (this.unsubscribe || !this.binding.current) return;
    const { pi, agents, binding } = this, manager = agents.manager;
    const find = (id: string) => {
      const current = binding.current;
      if (!current) return;
      // Look up only this session/branch, while retaining nested records for an explicit refusal.
      return manager.records().filter(record => record.id === id && record.ownerSessionId === current.sessionId
        && (record.anchorEntryId === null || current.ctx.sessionManager.getBranch().some(entry => entry.id === record.anchorEntryId)))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.runId.localeCompare(a.runId))[0];
    };
    const offRpc = registerRpcHandlers({ events: pi.events,
      spawn: async (type, prompt, raw) => {
        const captured = binding.current;
        if (!captured) throw new Error('No active session');
        const { request, options } = normalizeSpawn(type, prompt, raw);
        const run = await manager.start(request, agents.scope(captured.ctx), this.config(), undefined, options);
        await manager.awaitStartup(run);
        return { id: run.record.id };
      },
      getRecord: find,
      stop: async id => {
        const record = find(id)!;
        if (!active(record.state)) throw new Error('Agent is not running');
        await manager.stop(id, record.runId);
      },
      consume: id => {
        const record = find(id)!;
        const run = manager.runs.get(record.runId);
        if (active(record.state) || run && !run.settled) return false;
        agents.consume({ id, runId: record.runId, state: record.state, summary: '', settled: true });
        return true;
      },
      steer: async (id, message) => {
        const record = find(id)!;
        const run = manager.runs.get(record.runId);
        if (!run || run.settled || !active(record.state)) throw new Error('Agent is not running');
        await manager.send(id, message, agents.scope(binding.current!.ctx), this.config());
      },
    });
    const offEvents = manager.subscribeEvents((kind, run, details) => {
      const current = binding.current, record = manager.view(run);
      if (!current || record.ownerSessionId !== current.sessionId) return;
      if (record.anchorEntryId !== null && !current.ctx.sessionManager.getBranch().some(entry => entry.id === record.anchorEntryId)) return;
      if (kind !== 'usage' && !isTopLevelAgent(record)) return;
      const tokens = record.usage?.tokens;
      pi.events.emit(`subagents:${kind}`, { id: record.id, runId: record.runId, type: record.type,
        description: record.description ?? record.name, status: statusOf(record), isBackground: record.background,
        result: record.result, error: record.error, toolUses: record.toolUses, durationMs: record.elapsedMs,
        ...(tokens ? { tokens: { input: tokens.input, output: tokens.output, total: tokens.input + tokens.output } } : {}),
        ...(kind === 'usage' ? { model: record.model, thinking: record.thinking, depth: record.ancestors.length + 1,
          ...(record.parentAgentId ? { parentAgentId: record.parentAgentId } : {}), ...(record.workflowId ? { workflowId: record.workflowId } : {}) } : {}), ...details });
    });
    this.unsubscribe = () => { offRpc(); offEvents(); };
    pi.events.emit('subagents:ready', {});
  }
  detach(): void { this.unsubscribe?.(); this.unsubscribe = undefined; }
}
