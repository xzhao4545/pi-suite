import { Type, type TSchema, type Static } from 'typebox';
import { Value } from 'typebox/value';
import type { EntryRenderer, ExtensionAPI, MessageRenderer, ToolDefinition, ToolRenderers } from '@earendil-works/pi-coding-agent';
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

// Child and main sessions may give the same name different renderers; scope lookup to their API.
type Renderers = { tools: Map<string, ToolRenderers>; messages: Map<string, MessageRenderer>; entries: Map<string, EntryRenderer> };
const renderers = new WeakMap<ExtensionAPI, Renderers>();
function rendererRegistry(pi: ExtensionAPI): Renderers {
  let registry = renderers.get(pi);
  if (!registry) { registry = { tools: new Map(), messages: new Map(), entries: new Map() }; renderers.set(pi, registry); }
  return registry;
}
export const toolRenderer = (pi: ExtensionAPI, name: string): ToolRenderers | undefined => renderers.get(pi)?.tools.get(name);
export function customRendererLookup(pi: ExtensionAPI) {
  return {
    getMessageRenderer: (type: string) => renderers.get(pi)?.messages.get(type),
    getEntryRenderer: (type: string) => renderers.get(pi)?.entries.get(type),
  };
}
/** Main-session extensions can register renderers, but only SDK session owners can query Pi's runner.
 * Forward Suite's registrations unchanged and retain those same callbacks for its overlay readers.
 */
export function captureCustomRenderers(host: ExtensionAPI): ExtensionAPI {
  const pi: ExtensionAPI = { ...host,
    registerMessageRenderer(type, renderer) {
      host.registerMessageRenderer(type, renderer);
      rendererRegistry(pi).messages.set(type, renderer as MessageRenderer);
    },
    registerEntryRenderer(type, renderer) {
      host.registerEntryRenderer(type, renderer);
      rendererRegistry(pi).entries.set(type, renderer as EntryRenderer);
    },
  };
  return pi;
}
/** History is rebuilt before session_start; rendering must not wait for module admission. */
export function registerToolRenderers(pi: ExtensionAPI, defaults: Record<string, ToolRenderers>,
  compose: Record<string, (base: ToolRenderers) => ToolRenderers> = {}): void {
  const lookup = new Map(Object.entries(defaults).map(([name, base]) => [name, compose[name]?.(base) ?? base]));
  rendererRegistry(pi).tools = lookup;
  // Both live resolution and read-only lookup use the same display composition. next() preserves
  // registered/native definitions and other extensions; no execution tool is registered here.
  pi.registerToolRenderer((name, next) => {
    const base = next() ?? defaults[name];
    return base && compose[name] ? compose[name](base) : base;
  });
}
/** Initial load has no runtime API yet; late refreshes preserve the active selection. */
export function registerBoundTool<P extends TSchema>(pi: ExtensionAPI, tool: ToolDefinition<P>, activate: boolean | 'initial' = false): void {
  // Lookup erases the parameter schema; the host supplies this tool's own arguments.
  rendererRegistry(pi).tools.set(tool.name, tool as unknown as ToolRenderers);
  if (activate === 'initial') { pi.registerTool(tool); return; }
  const active = pi.getActiveTools();
  pi.registerTool(tool);
  pi.setActiveTools(activate ? [...new Set([...active, tool.name])] : active);
}

export const LIST_LIMITS = { defaultLimit: 10, maxLimit: 100, defaultBytes: 4096 };
/** Validate model input without guessing away conflicting fields; return a usable repair. */
export function checkedArguments<P extends TSchema>(schema: P, hint: string) {
  return (args: unknown): Static<P> => {
    if (!Value.Check(schema, args)) throw new ToolError('INVALID_ARGS', `${Value.Errors(schema, args)[0]?.message ?? 'Invalid arguments'}. ${hint}`);
    return args as Static<P>;
  };
}
/** Filters and paging belong to list tools; single-item tools define their own fields. */
export function listFields<S extends string>(states: readonly S[]) {
  return {
    state: Type.Optional(Type.Unsafe<S>({ type: 'string', enum: [...states], description: `Default ${states[0]}` })),
    scope: Type.Optional(Type.Union([Type.Literal('session'), Type.Literal('workspace')], { description: 'session (default): what this session sees; workspace: every session in this workspace' })),
    cursor: Type.Optional(Type.String({ maxLength: 200, description: 'nextCursor from a previous page' })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: LIST_LIMITS.maxLimit, description: `Default ${LIST_LIMITS.defaultLimit}` })),
  };
}

type Position = { createdAt: string; id: string };
/** Newest first; ties broken by ID so pages stay stable while items are added. */
export function newestFirst(a: Position, b: Position): number {
  return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
}
/** Resume from the last row's position, even if that row has since been removed. */
export function paginate<T>(items: T[], position: (item: T) => Position, cursor: string | undefined, limit: number,
  options: { oldest?: boolean; size?: (item: T) => number; budgetBytes?: number } = {}): { page: T[]; nextCursor?: string } {
  const compare = (a: Position, b: Position) => newestFirst(a, b) * (options.oldest ? -1 : 1);
  let rows = [...items].sort((a, b) => compare(position(a), position(b)));
  if (cursor) {
    const [createdAt, id] = Buffer.from(cursor, 'base64url').toString().split('|');
    if (!createdAt || !id) throw new ToolError('INVALID_ARGS', 'Invalid cursor. Use nextCursor from the same list or omit cursor.');
    rows = rows.filter(row => compare(position(row), { createdAt, id }) > 0);
  }
  const page: T[] = []; let bytes = 0;
  for (const row of rows) {
    const size = options.size?.(row) ?? 0;
    if (page.length >= limit || page.length && bytes + size > (options.budgetBytes ?? Infinity)) break;
    page.push(row); bytes += size;
  }
  const last = page.at(-1);
  return { page, nextCursor: rows.length > page.length && last ? Buffer.from(`${position(last).createdAt}|${position(last).id}`).toString('base64url') : undefined };
}

/** Byte-offset paging, regex search and default smart truncation; shared by job_read and agent_read. */
export const readFields = {
  offset: Type.Optional(Type.Integer({ minimum: 0, description: 'Raw byte offset; returns nextOffset' })),
  limitBytes: Type.Optional(Type.Integer({ minimum: 64, maximum: READ_LIMITS.maxBytes, description: `Default ${READ_LIMITS.defaultBytes}` })),
  search: Type.Optional(Type.String({ minLength: 1, maxLength: 500, description: 'Regex, /re/flags; case-insensitive by default' })),
  context: Type.Optional(Type.Integer({ minimum: 0, maximum: READ_LIMITS.maxContext, description: `Lines around matches, default ${READ_LIMITS.defaultContext}` })),
};
export function rejectContextWithoutSearch(params: { search?: string; context?: number }): void {
  if (params.context !== undefined && params.search === undefined) throw new ToolError('INVALID_ARGS', 'context requires search. Add search or omit context.');
}

/** stop result shared by job_stop and agent_stop; affected lists every cascaded object's real state. */
export type StopAffected = { id: string; state: string; cleanup?: string };
export type StopOutcome = { requested: boolean; state: string; cleanup: string; affected: StopAffected[] };

/** First line is the summary and the last line is the next call; undefined lines are dropped. */
export function textResult<D>(lines: (string | undefined)[], details: D) {
  return { content: [{ type: 'text' as const, text: lines.filter(line => line !== undefined).join('\n') }], details };
}
