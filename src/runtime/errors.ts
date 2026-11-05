/** Stable error codes shared by every model tool (doc/todo/pi-suite/tool-design.md). */
export type ToolErrorCode =
  | 'INVALID_ARGS' | 'NOT_FOUND' | 'AMBIGUOUS_NAME' | 'HISTORY_READ_ONLY' | 'NOT_RUNNING' | 'USER_CONTROL'
  | 'STALE_BINDING' | 'CLOSING' | 'UNSUPPORTED_STREAM' | (string & {});
export class ToolError extends Error {
  code: ToolErrorCode; objectId?: string;
  constructor(code: ToolErrorCode, message: string, objectId?: string) {
    // The code leads the message because tool errors reach the model as text only.
    super(`${code}: ${message}`); this.name = 'ToolError'; this.code = code; this.objectId = objectId;
  }
}
