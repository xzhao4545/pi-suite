// Imported/adapted from @tintinweb/pi-subagents 0.23.0 src/cross-extension-rpc.ts (MIT).
// Model resolution and ownership are supplied by the suite's existing session scope.
import { isTopLevelAgent, type AgentRecord } from '../types.ts';

export interface EventBus {
  on(event: string, handler: (data: unknown) => void): () => void;
  emit(event: string, data: unknown): void;
}
export type RpcReply<T = void> = { success: true; data?: T } | { success: false; error: string };
export const PROTOCOL_VERSION = 2;
export interface RpcDeps {
  events: EventBus;
  spawn(type: string, prompt: string, options: unknown): Promise<{ id: string }>;
  getRecord(id: string): AgentRecord | undefined;
  stop(id: string): Promise<void>;
  consume(id: string): boolean;
  steer(id: string, message: string): Promise<void>;
}

function handleRpc<P extends { requestId: string }>(events: EventBus, channel: string,
  fn: (params: P) => unknown | Promise<unknown>): () => void {
  return events.on(channel, async raw => {
    const params = raw as P;
    try {
      if (typeof params?.requestId !== 'string' || !params.requestId.trim()) throw new Error('requestId must be a non-empty string');
      const data = await fn(params);
      const reply: RpcReply<unknown> = { success: true };
      if (data !== undefined) reply.data = data;
      events.emit(`${channel}:reply:${params.requestId}`, reply);
    } catch (error) {
      events.emit(`${channel}:reply:${params?.requestId}`, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
}

export function registerRpcHandlers(deps: RpcDeps): () => void {
  const { events } = deps;
  const assertOwned = (id: string): AgentRecord => {
    const record = deps.getRecord(id);
    if (!record) throw new Error('Agent not found');
    if (!isTopLevelAgent(record)) throw new Error('Agent is owned by another agent or workflow');
    return record;
  };
  const unsubscribers = [
    handleRpc(events, 'subagents:rpc:ping', () => ({ version: PROTOCOL_VERSION })),
    handleRpc<{ requestId: string; type: string; prompt: string; options?: unknown }>(events, 'subagents:rpc:spawn', params =>
      deps.spawn(params.type, params.prompt, params.options)),
    handleRpc<{ requestId: string; agentId: string }>(events, 'subagents:rpc:stop', ({ agentId }) => {
      assertOwned(agentId); return deps.stop(agentId);
    }),
    handleRpc<{ requestId: string; agentId: string }>(events, 'subagents:rpc:consume', ({ agentId }) => {
      // Keep this prefix synchronous: completion listeners may consume before notification admission.
      assertOwned(agentId);
      if (!deps.consume(agentId)) throw new Error('Agent not found or still running');
    }),
    handleRpc<{ requestId: string; agentId: string; message: unknown }>(events, 'subagents:rpc:steer', ({ agentId, message }) => {
      if (typeof message !== 'string' || !message.trim()) throw new Error('Steer message must be a non-empty string');
      assertOwned(agentId); return deps.steer(agentId, message);
    }),
  ];
  return () => { for (const unsubscribe of unsubscribers) unsubscribe(); };
}
