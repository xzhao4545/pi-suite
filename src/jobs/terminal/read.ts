import { READ_LIMITS, type ReadSource } from '../../runtime/read.ts';

// Password prompts are an output boundary, distinct from sensitive input logging.
// The source bytes stay on disk; replace only echoed bytes, retaining every raw offset.
// Word boundaries are judged on visible text: Windows ConPTY emits CSI sequences such
// as `ESC[?25h` directly before prompts, and their alphabetic final byte would
// otherwise defeat `\b`.
const PASSWORD = /(?:\b|(?<=\x1b\[[0-?]*[ -/]*[@-~]))(?:password|passphrase|passcode|pin(?: code)?)\b[^\r\n:：?]{0,80}[:：?][ \t]*|(?:密码|口令)[^\r\n:：?]{0,80}[:：?][ \t]*/iu;
// Terminal syntax and blanks that draw no glyph; an unterminated sequence at a read
// boundary is consumed as silent so its tail is not mistaken for echoed text.
const SILENT = /\x1b(?:\[[0-?]*[ -/]*[@-~]?|\][^\x07\x1b]*(?:\x07|\x1b\\)?|[ -~]?)|[\x00-\x20\x7f]/y;
const VERTICAL_MOVE = /^\x1b\[[0-?]*[ -/]*[HfAFd]$/;
const CARRY_BYTES = 256;
const EMPTY = Buffer.alloc(0);

/**
 * hidden: the rest of the current line is echo. pending: a prompt has shown no echo yet.
 * Windows ConPTY repaints after leaving the alternate screen: it redraws the prompt row
 * and blank rows, then moves the cursor back to the prompt (CSI H/f/A/F/d) before the
 * echo. While pending, blank rows are skipped and text drawn after such a move is still
 * hidden; text without a move (sudo's "Sorry, try again") ends the prompt and stays.
 */
type Mask = { carry: Buffer; hidden: boolean; echo: boolean; pending: boolean; moved: boolean };

function tail(bytes: Buffer): Buffer {
  let start = Math.max(0, bytes.length - CARRY_BYTES);
  // A carry starts on a code point boundary, otherwise decoding replacement bytes
  // shifts the prompt's raw-byte end and can leave part of an echo unmasked.
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
  return Buffer.from(bytes.subarray(start));
}

/** First drawn character at or after `from`, and whether a vertical cursor move precedes it. */
function firstVisible(text: string, from: number): { at: number; moved: boolean } {
  let moved = false;
  for (let index = from; index < text.length;) {
    SILENT.lastIndex = index;
    const silent = SILENT.exec(text);
    if (!silent) return { at: index, moved };
    moved ||= VERTICAL_MOVE.test(silent[0]);
    index += silent[0].length;
  }
  return { at: -1, moved };
}

/** Advance the mask over one line segment of `bytes`, blanking hidden bytes in `output`. */
function maskSegment(state: Mask, bytes: Buffer, output: Buffer | undefined, from: number, to: number, eol: boolean): void {
  const line = bytes.subarray(from, to), joined = Buffer.concat([state.carry, line]), text = joined.toString('utf8');
  // Byte position in this segment of a UTF-16 index in the carry-prefixed text.
  const at = (index: number) => Math.max(0, Buffer.byteLength(text.slice(0, index)) - state.carry.length);
  let hideFrom = state.hidden ? 0 : -1;
  if (state.hidden) state.echo ||= firstVisible(line.toString('utf8'), 0).at >= 0;
  else {
    const match = PASSWORD.exec(text);
    if (match) {
      const end = match.index + match[0].length;
      hideFrom = at(end); state.hidden = true; state.pending = false;
      state.echo = firstVisible(text, end).at >= 0;
    } else if (state.pending) {
      const first = firstVisible(text, 0);
      state.moved ||= first.moved;
      if (first.at >= 0) {
        state.pending = false;
        if (state.moved) { hideFrom = at(first.at); state.hidden = state.echo = true; }
      }
    }
  }
  if (hideFrom >= 0) output?.fill(32, from + hideFrom, to);
  if (!eol) { state.carry = tail(joined); return; }
  state.pending ||= state.hidden && !state.echo;
  Object.assign(state, { carry: EMPTY, hidden: false, echo: false, moved: false });
}

/** A masked view of the original log, including pages starting after a prompt. */
export function passwordSafeSource(source: ReadSource): ReadSource {
  let end = 0, state: Mask = { carry: EMPTY, hidden: false, echo: false, pending: false, moved: false };

  async function lineStart(offset: number): Promise<number> {
    for (let position = offset; position > 0;) {
      const from = Math.max(0, position - READ_LIMITS.chunk), chunk = await source.read(from, position - from);
      const newline = chunk.lastIndexOf(10);
      if (newline >= 0) return from + newline + 1;
      position = from;
    }
    return 0;
  }
  /** Rows above `start`, newest first: blanks keep an unanswered prompt pending, the first drawn row decides. */
  async function pendingAt(start: number): Promise<boolean> {
    for (let end = start - 1; end > 0;) {
      const from = Math.max(0, end - READ_LIMITS.chunk), chunk = await source.read(from, end - from);
      let to = chunk.length;
      for (;;) {
        const newline = to > 0 ? chunk.lastIndexOf(10, to - 1) : -1;
        // A partial first row is reread whole from the next chunk; only an over-long row is judged by its tail.
        if (newline < 0 && from > 0 && to < chunk.length) break;
        const text = chunk.subarray(newline + 1, to).toString('utf8'), match = PASSWORD.exec(text);
        if (match) return firstVisible(text, match.index + match[0].length).at < 0;
        if (firstVisible(text, 0).at >= 0 || newline < 0) return false;
        to = newline;
      }
      end = from + to;
    }
    return false;
  }
  /** Rebuild the mask at a random offset by replaying its line prefix after the rows above. */
  async function context(offset: number): Promise<Mask> {
    const start = await lineStart(offset);
    const next: Mask = { carry: EMPTY, hidden: false, echo: false, pending: await pendingAt(start), moved: false };
    for (let position = start; position < offset;) {
      const chunk = await source.read(position, Math.min(READ_LIMITS.chunk, offset - position));
      if (!chunk.length) break;
      maskSegment(next, chunk, undefined, 0, chunk.length, false);
      position += chunk.length;
    }
    return next;
  }

  return {size: source.size, close: () => source.close(), async read(offset, length) {
    if (offset !== end) state = await context(offset);
    const bytes = await source.read(offset, length), output = Buffer.from(bytes);
    // Keep only a short raw suffix between sequential reads; a split prompt is
    // recognized without rescanning the whole file or retaining a second transcript.
    for (let from = 0; from < bytes.length;) {
      const newline = bytes.indexOf(10, from), to = newline < 0 ? bytes.length : newline;
      maskSegment(state, bytes, output, from, to, newline >= 0);
      from = to + 1;
    }
    end = offset + bytes.length;
    return output;
  }};
}
