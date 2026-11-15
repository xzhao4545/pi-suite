/** A settlement snapshot is xterm's restore stream, never a slice of output.log.
 * Storage validates its wire envelope without loading the live terminal renderer. */
export interface TerminalSnapshot {
  version: 1; cols: number; rows: number; scrollback: number; data: string;
  cursor: { x: number; y: number; visible: boolean }; alternate: boolean;
}
export const SNAPSHOT_SCROLLBACK = 1000;
export const SNAPSHOT_BYTES = 4 * 1024 * 1024;
