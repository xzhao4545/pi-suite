import { Type, type TSchema } from 'typebox';
import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { READ_LIMITS } from './read.ts';
import { ToolError } from './errors.ts';

/**
 * Shared model-tool conventions (doc/current/runtime/tools.md): one shape for IDs, list
 * filters, cursors, reads and stop results. jobs, agents and tasks build their parameters from
 * these pieces so equal meanings keep equal names, units, limits and exclusivity rules.
 */
/** job_/agent_/run_ use 8 hex digits; workflow run IDs use 12. */
export const objectId = (prefix: 'job' | 'agent' | 'run' | 'wf', example: string) =>
  Type.String({ pattern: `^${prefix}_[a-f0-9]{${prefix === 'wf' ? 12 : 8}}$`, description: `${prefix} ID, e.g. ${example}` });
export const WAIT_ID_PATTERN = '^(?:(?:job|agent)_[a-f0-9]{8}|wf_[a-f0-9]{12})$';

/** Pi late registration refreshes all extension tools; preserve the user's active selection. */
export function registerBoundTool<P extends TSchema>(pi: ExtensionAPI, tool: ToolDefinition<P>, activate = false): void {
  const active = pi.getActiveTools();
  pi.registerTool(tool);
  pi.setActiveTools(activate ? [...new Set([...active, tool.name])] : active);
}

export const LIST_LIMITS = { defaultLimit: 20, maxLimit: 100 };
/** id views one item; the rest filter and page a list, newest first. id and list fields are exclusive. */
export function listFields<S extends string>(states: readonly S[]) {
  return {
    state: Type.Optional(Type.Union(states.map(state => Type.Literal(state)), { description: `Default ${states[0]}` })),
    scope: Type.Optional(Type.Union([Type.Literal('session'), Type.Literal('workspace')], { description: 'session (default): what this session sees; workspace: every session in this workspace' })),
    cursor: Type.Optional(Type.String({ maxLength: 200, description: 'nextCursor from a previous page' })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: LIST_LIMITS.maxLimit, description: `Default ${LIST_LIMITS.defaultLimit}` })),
  };
}
export function rejectListWithId(params: { id?: string; state?: string; scope?: string; cursor?: string; limit?: number }): void {
  if (params.id !== undefined && (params.state ?? params.scope ?? params.cursor ?? params.limit) !== undefined) {
    throw new ToolError('INVALID_ARGS', 'id cannot be combined with state, scope, cursor or limit');
  }
}

type Position = { createdAt: string; id: string };
/** Newest first; ties broken by ID so pages stay stable while items are added. */
export function newestFirst(a: Position, b: Position): number {
  return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
}
/** Sorts newest first and returns one page after cursor; the cursor encodes the last row's position. */
export function paginate<T>(items: T[], position: (item: T) => Position, cursor: string | undefined, limit: number): { page: T[]; nextCursor?: string } {
  let rows = [...items].sort((a, b) => newestFirst(position(a), position(b)));
  if (cursor) {
    const [createdAt, id] = Buffer.from(cursor, 'base64url').toString().split('|');
    if (!createdAt || !id) throw new ToolError('INVALID_ARGS', 'cursor is not a nextCursor from this list');
    rows = rows.filter(row => newestFirst(position(row), { createdAt, id }) > 0);
  }
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return { page, nextCursor: rows.length > limit && last ? Buffer.from(`${position(last).createdAt}|${position(last).id}`).toString('base64url') : undefined };
}

/** Byte-offset paging, regex search and default smart truncation; shared by job_read and agent_read. */
export const readFields = {
  offset: Type.Optional(Type.Integer({ minimum: 0, description: 'Raw byte offset; returns nextOffset' })),
  limitBytes: Type.Optional(Type.Integer({ minimum: 64, maximum: READ_LIMITS.maxBytes, description: `Default ${READ_LIMITS.defaultBytes}` })),
  search: Type.Optional(Type.String({ minLength: 1, maxLength: 500, description: 'Regex, /re/flags; case-insensitive by default' })),
  context: Type.Optional(Type.Integer({ minimum: 0, maximum: READ_LIMITS.maxContext, description: `Lines around matches, default ${READ_LIMITS.defaultContext}` })),
};
export function rejectContextWithoutSearch(params: { search?: string; context?: number }): void {
  if (params.context !== undefined && params.search === undefined) throw new ToolError('INVALID_ARGS', 'context requires search');
}

/** stop result shared by job_stop and agent_stop; affected lists every cascaded object's real state. */
export type StopAffected = { id: string; state: string; cleanup?: string };
export type StopOutcome = { requested: boolean; state: string; cleanup: string; affected: StopAffected[] };

/** First line summary, optional lines, last line the next call; undefined lines are dropped. */
export function textResult<D>(lines: (string | undefined)[], details: D) {
  return { content: [{ type: 'text' as const, text: lines.filter(line => line !== undefined).join('\n') }], details };
}
