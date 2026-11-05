import { READ_LIMITS, type ReadSource } from '../../runtime/read.ts';

// Password prompts are an output boundary, distinct from sensitive input logging.
// The source bytes stay on disk; replace only echoed bytes, retaining every raw offset.
const PASSWORD = /(?:\b(?:password|passphrase|passcode|pin(?: code)?)\b|密码|口令)[^\r\n:：?]{0,80}[:：?][ \t]*/iu;
const CARRY_BYTES = 256;
function tail(bytes: Buffer): Buffer {
  let start = Math.max(0, bytes.length - CARRY_BYTES);
  // A carry starts on a code point boundary, otherwise decoding replacement bytes
  // shifts the prompt's raw-byte end and can leave part of an echo unmasked.
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
  return Buffer.from(bytes.subarray(start));
}

/** A masked view of the original log, including pages starting after a prompt. */
export function passwordSafeSource(source: ReadSource): ReadSource {
  let end = 0, hidden = false;
  let carry: Buffer = Buffer.alloc(0);
  async function context(offset: number): Promise<void> {
    carry = Buffer.alloc(0); hidden = false;
    let suffix = Buffer.alloc(0);
    for (let position = offset; position > 0;) {
      const start = Math.max(0, position - READ_LIMITS.chunk), chunk = await source.read(start, position - start);
      const newline = chunk.lastIndexOf(10), line = chunk.subarray(newline + 1);
      const joined = Buffer.concat([line, suffix]);
      if (!carry.length) carry = tail(joined);
      if (PASSWORD.test(joined.toString('utf8'))) { hidden = true; break; }
      if (newline >= 0) break;
      suffix = Buffer.from(line.subarray(0, CARRY_BYTES)); position = start;
    }
  }
  return {size: source.size, close: () => source.close(), async read(offset, length) {
    if (offset !== end) await context(offset);
    const bytes = await source.read(offset, length), output = Buffer.from(bytes);
    let from = 0;
    // Keep only a short raw suffix between sequential reads; a split prompt is
    // recognized without rescanning the whole file or retaining a second transcript.
    while (from < bytes.length) {
      const newline = bytes.indexOf(10, from), to = newline < 0 ? bytes.length : newline;
      const line = bytes.subarray(from, to), joined = Buffer.concat([carry, line]);
      const match = PASSWORD.exec(joined.toString('utf8'));
      if (hidden) output.fill(32, from, to);
      else if (match) {
        const start = Buffer.byteLength(joined.toString('utf8').slice(0, match.index + match[0].length)) - carry.length;
        output.fill(32, from + Math.max(0, start), to); hidden = true;
      }
      carry = newline < 0 ? tail(joined) : Buffer.alloc(0);
      if (newline >= 0) hidden = false;
      from = to + 1;
    }
    end = offset + bytes.length;
    return output;
  }};
}
