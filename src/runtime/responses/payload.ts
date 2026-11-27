import { createHash } from 'node:crypto';

type Item = Record<string, unknown>;
export type ReplayPayload = Item & { input: Item[] };
export type ReplayReferences = { ids: string[]; ciphers: string[] };
export type RepairKind = 'id' | 'cipher';
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const object = (value: unknown): value is Item => value !== null && typeof value === 'object' && !Array.isArray(value);
const upstreamId = (item: Item): string | undefined => typeof item.id === 'string' &&
  /^(?:rs|msg|fc|ctc)_/.test(item.id) && !item.id.startsWith('msg_pi_') ? item.id : undefined;

/** Validate only at the wire boundary: deleting an ID is safe only for self-contained items.
 * Pi 1.5.0 serializes grammar calls as custom_tool_call/input with a separate call_id.
 */
export function replayPayload(value: unknown, model: string): ReplayPayload | undefined {
  if (!object(value) || value.model !== model || value.store === true ||
      value.previous_response_id !== undefined || !Array.isArray(value.input)) return;
  for (const item of value.input) {
    if (!object(item)) return;
    switch (item.type) {
      case undefined: // SDK's input messages omit type.
      case 'message':
        if (!['user', 'assistant', 'system', 'developer'].includes(String(item.role)) ||
            !(typeof item.content === 'string' || Array.isArray(item.content))) return;
        break;
      case 'reasoning':
        if (typeof item.encrypted_content !== 'string' || !item.encrypted_content) return;
        break;
      case 'function_call':
      case 'custom_tool_call':
        if (typeof item.call_id !== 'string' || typeof item.name !== 'string' ||
            typeof item[item.type === 'function_call' ? 'arguments' : 'input'] !== 'string') return;
        break;
      case 'function_call_output':
      case 'custom_tool_call_output':
        if (typeof item.call_id !== 'string' || !('output' in item)) return;
        break;
      // These are SDK-generated inline declarations/configuration, not resource references.
      case 'additional_tools': case 'configuration_update': case 'tool_search_call': case 'tool_search_output':
        if (item.id !== undefined) return;
        break;
      default: return; // Includes item_reference, compaction and server-side tool state.
    }
    if (item.id !== undefined && !upstreamId(item) && !(typeof item.id === 'string' && item.id.startsWith('msg_pi_'))) return;
  }
  return value as ReplayPayload;
}

/** Capture only what actually leaves after projection so a later failure can be
 * matched even when an earlier ID repair already removed every upstream ID.
 * Copy only the changed path; retained body, phase, arguments and call_id keep identity.
 */
export function projectReplay(payload: ReplayPayload, isolated?: { ids: ReadonlySet<string>; ciphers: ReadonlySet<string> }):
    ReplayReferences & { projected?: ReplayPayload } {
  const ids: string[] = [], ciphers: string[] = [];
  let input: Item[] | undefined;
  for (const [index, item] of payload.input.entries()) {
    if (item.type === 'reasoning') {
      const cipher = item.encrypted_content as string; // replayPayload validated the wire shape.
      // The ciphertext belongs to the former account, so removing only the ID cannot make it replayable.
      if (isolated?.ciphers.size && isolated.ciphers.has(sha256(cipher))) {
        input ??= payload.input.slice(0, index);
        continue;
      }
      ciphers.push(cipher);
    }
    const id = upstreamId(item);
    if (id && isolated?.ids.has(id)) {
      const { id: _id, ...replay } = item;
      (input ??= payload.input.slice(0, index)).push(replay);
    } else {
      if (id && ['reasoning', 'message', 'function_call', 'custom_tool_call'].includes(String(item.type))) ids.push(id);
      input?.push(item);
    }
  }
  return { ids, ciphers, projected: input && { ...payload, input } };
}

/** SDK errors are normalized even when an HTTP status callback is unavailable.
 * Require a specific ownership/dependency or encrypted reasoning failure, not a generic HTTP 400 or crypto error.
 */
export function resourceMismatch(error: string, { ids, ciphers }: ReplayReferences): RepairKind | undefined {
  const text = error.toLowerCase();
  if (/\b(?:401|403|429|5\d\d)\b|rate.?limit|quota|billing|context.{0,20}(?:length|window)|maximum context/.test(text)) return;
  if (/\bencrypted\b[^\r\n]*?\b(?:cannot|could not) be (?:verified|decrypted)\b/.test(text)) {
    if (!ciphers.length) return;
    // Gateways can identify a ciphertext without naming its item. Compare any
    // reported fragment case-sensitively; a mismatch invalidates the correlation.
    for (const [, prefix, suffix] of error.matchAll(/(?<![A-Za-z0-9_-])([A-Za-z0-9_-]{4,})\.{3}([A-Za-z0-9_-]{4,})/g)) {
      if (!ciphers.some(cipher => cipher.startsWith(prefix) && cipher.endsWith(suffix))) return;
    }
    return 'cipher';
  }
  const namedItem = ids.some(id => error.includes(id));
  const resource = /(?:different|another|across|cross)[ -](?:openai[ -])?(?:resource|organization|project)|(?:resource|organization|project).{0,50}(?:mismatch|does not match|not belong)/.test(text);
  // Gateways may omit the item ID and qualify/redact the resource name. Recognize
  // the explicit creation-origin sentence, not arbitrary words between "different" and "resource".
  const createdElsewhere = /\bitem was created (?:under|in) (?:a different|another) [^.!?\r\n]{0,80}\b(?:resource|organization|project)\b/.test(text);
  const ownership = namedItem && /not found|does not exist|belongs to|was created in|provided without.{0,80}required|not owned by/.test(text);
  if (resource || createdElsewhere || ownership) return 'id';
}
