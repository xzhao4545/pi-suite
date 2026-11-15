type Item = Record<string, unknown>;
export type ReplayPayload = Item & { input: Item[] };
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

export function replayIds(payload: ReplayPayload): string[] {
  return payload.input.flatMap(item => {
    if (!['reasoning', 'message', 'function_call', 'custom_tool_call'].includes(String(item.type))) return [];
    const id = upstreamId(item); return id ? [id] : [];
  });
}

/** Copy only the changed path. Body, cipher, phase, arguments and call_id retain identity. */
export function isolateIds(payload: ReplayPayload, ids: ReadonlySet<string>): ReplayPayload | undefined {
  let changed = false;
  const input = payload.input.map(item => {
    const id = upstreamId(item);
    if (!id || !ids.has(id)) return item;
    changed = true;
    const { id: _id, ...replay } = item;
    return replay;
  });
  return changed ? { ...payload, input } : undefined;
}

/** SDK errors are normalized even when an HTTP status callback is unavailable.
 * Require a specific ownership/dependency failure, not a generic HTTP 400 or crypto error.
 */
export function resourceMismatch(error: string, ids: readonly string[]): boolean {
  const text = error.toLowerCase();
  if (/\b(?:401|403|429|5\d\d)\b|rate.?limit|quota|billing|context.{0,20}(?:length|window)|maximum context/.test(text)) return false;
  const namedItem = ids.some(id => error.includes(id));
  const resource = /(?:different|another|across|cross)[ -](?:openai[ -])?(?:resource|organization|project)|(?:resource|organization|project).{0,50}(?:mismatch|does not match|not belong)/.test(text);
  // Gateways may omit the item ID and qualify/redact the resource name. Recognize
  // the explicit creation-origin sentence, not arbitrary words between "different" and "resource".
  const createdElsewhere = /\bitem was created (?:under|in) (?:a different|another) [^.!?\r\n]{0,80}\b(?:resource|organization|project)\b/.test(text);
  const ownership = namedItem && /not found|does not exist|belongs to|was created in|provided without.{0,80}required|not owned by/.test(text);
  const cipher = namedItem && /encrypted.{0,40}(?:cannot|could not|failed|invalid|verif|decrypt)|(?:decrypt|verif).{0,40}(?:encrypted|reasoning)/.test(text);
  return resource || createdElsewhere || ownership || cipher;
}
