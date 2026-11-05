import { open, type FileHandle } from 'node:fs/promises';
import { ToolError } from './errors.ts';

/**
 * Shared output reading for job logs and agent transcripts. Offsets are always raw source
 * bytes so pages and searches can be resumed exactly; rendering (ANSI removal, CR overwrite)
 * only changes the returned text.
 */
export type ReadSource = { size: number; read(offset: number, length: number): Promise<Buffer>; close(): Promise<void> };
export type ReadRequest = { offset?: number; limitBytes?: number; search?: string; context?: number };
export type ReadPage = {
  text: string; offset: number; nextOffset: number; totalBytes: number; endOfStream: boolean;
  truncated?: { head: [number, number]; tail: [number, number]; omittedBytes: number; keyLines: number };
  matches?: number;
};
export const READ_LIMITS = { defaultBytes: 16384, maxBytes: 65536, maxMatches: 50, defaultContext: 2, maxContext: 20, chunk: 65536 };
// Lines worth surfacing from an omitted middle section; matched case-insensitively.
const KEY_LINE = /\b(error|errors|fail(?:ed|ure|s)?|fatal|exception|traceback|panic|denied|not found|warn(?:ing)?|exit code|segmentation fault|assert(?:ion)?)\b/i;

export async function fileSource(path: string): Promise<ReadSource> {
  const file: FileHandle = await open(path, 'r');
  const size = (await file.stat()).size;
  return { size, async read(offset, length) {
    const buffer = Buffer.alloc(Math.max(0, Math.min(length, size - offset)));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
    return buffer.subarray(0, bytesRead);
  }, close: () => file.close() };
}
export function textSource(text: string): ReadSource {
  const buffer = Buffer.from(text, 'utf8');
  return { size: buffer.length, read: async (offset, length) => buffer.subarray(offset, offset + length), close: async () => {} };
}

/** Byte length to cut at so a multi-byte UTF-8 character is never split at the end. */
function utf8End(buffer: Buffer, end: number): number {
  let lead = end - 1;
  while (lead > 0 && (buffer[lead] & 0xc0) === 0x80) lead--;
  const byte = buffer[lead];
  const length = byte >= 0xc2 && byte <= 0xdf ? 2 : byte >= 0xe0 && byte <= 0xef ? 3 : byte >= 0xf0 && byte <= 0xf4 ? 4 : 1;
  return lead + length > end ? lead : end;
}
function utf8Start(buffer: Buffer): number {
  let start = 0;
  while (start < Math.min(3, buffer.length) && (buffer[start] & 0xc0) === 0x80) start++;
  return start;
}
function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1048576).toFixed(1)} MiB`;
}
/**
 * Search and monitor trigger patterns: `/re/flags`, or a bare pattern matched case-insensitively.
 * Invalid caller input is a tool INVALID_ARGS error.
 */
export function compileSearch(search: string): RegExp {
  const literal = /^\/(.*)\/([a-z]*)$/s.exec(search);
  try { return literal ? new RegExp(literal[1], literal[2].replace('g', '')) : new RegExp(search, 'i'); }
  catch (error) { throw new ToolError('INVALID_ARGS', `Invalid search pattern: ${error instanceof Error ? error.message : String(error)}`); }
}

/** Streams complete lines with their starting byte offsets from [from, to). */
async function* lines(source: ReadSource, from: number, to: number): AsyncGenerator<{ offset: number; bytes: Buffer }> {
  let pending = Buffer.alloc(0), pendingAt = from;
  for (let position = from; position < to;) {
    const chunk = await source.read(position, Math.min(READ_LIMITS.chunk, to - position));
    if (!chunk.length) break;
    position += chunk.length;
    let data = Buffer.concat([pending, chunk]), start = 0;
    for (let index = data.indexOf(10); index >= 0; index = data.indexOf(10, start)) {
      yield { offset: pendingAt + start, bytes: data.subarray(start, index) };
      start = index + 1;
    }
    pendingAt += start; pending = Buffer.from(data.subarray(start));
  }
  if (pending.length) yield { offset: pendingAt, bytes: pending };
}

export async function readBounded(source: ReadSource, request: ReadRequest, render: (raw: string) => string): Promise<ReadPage> {
  const limit = request.limitBytes ?? READ_LIMITS.defaultBytes;
  const size = source.size;
  if (request.search !== undefined) return search(source, request, render, limit);
  if (request.offset !== undefined) {
    const offset = Math.min(request.offset, size);
    const buffer = await source.read(offset, limit + 3);
    // The snapshot may end while a live writer is part-way through a UTF-8 character.
    // Leave those bytes for the next page rather than emitting a replacement character.
    const start = utf8Start(buffer), end = utf8End(buffer, Math.min(limit, buffer.length));
    const nextOffset = offset + Math.max(start, end);
    return { text: render(buffer.subarray(start, Math.max(start, end)).toString('utf8')), offset: offset + start, nextOffset, totalBytes: size, endOfStream: nextOffset >= size };
  }
  if (size <= limit) {
    const buffer = await source.read(0, size);
    return { text: render(buffer.toString('utf8')), offset: 0, nextOffset: size, totalBytes: size, endOfStream: true };
  }
  // Smart default: head 20%, key lines from the omitted middle 30%, tail 50%, aligned to lines.
  const headBuffer = await source.read(0, Math.floor(limit * 0.2));
  const headEnd = headBuffer.lastIndexOf(10) + 1 || utf8End(headBuffer, headBuffer.length);
  const tailBudget = Math.floor(limit * 0.5);
  const tailRaw = await source.read(size - tailBudget, tailBudget);
  const tailCut = tailRaw.indexOf(10) + 1 || utf8Start(tailRaw);
  const tailStart = size - tailBudget + tailCut;
  const keyBudget = limit - headEnd - (size - tailStart);
  // Each key line carries its preceding line for context. Keep the earliest blocks within half
  // of the budget and a rolling window of the latest blocks in the rest.
  const first: string[] = [], recent: { text: string; bytes: number }[] = [];
  let keyLines = 0, firstBytes = 0, recentBytes = 0, previous: string | undefined;
  for await (const line of lines(source, headEnd, tailStart)) {
    const text = render(line.bytes.toString('utf8'));
    if (KEY_LINE.test(text)) {
      keyLines++;
      const block = `${previous === undefined ? '' : `  ${previous}\n`}> ${text}`, bytes = Buffer.byteLength(block) + 1;
      if (!recent.length && (firstBytes + bytes <= keyBudget / 2 || !first.length)) { first.push(block); firstBytes += bytes; }
      else {
        recent.push({ text: block, bytes }); recentBytes += bytes;
        while (recent.length > 1 && recentBytes > keyBudget - firstBytes) recentBytes -= recent.shift()!.bytes;
      }
      previous = undefined;
    } else previous = text;
  }
  const picked = [...first, ...(keyLines > first.length + recent.length ? ['  …'] : []), ...recent.map(item => item.text)];
  const omitted = tailStart - headEnd;
  const marker = `[… ${formatBytes(omitted)} omitted (bytes ${headEnd}–${tailStart}), ${keyLines} matching lines; read with offset or search …]`;
  const text = [render(headBuffer.subarray(0, headEnd).toString('utf8')).replace(/\n$/, ''), marker, ...picked,
    ...(picked.length ? ['[… end of matching lines …]'] : []), render(tailRaw.subarray(tailCut).toString('utf8'))].join('\n');
  return { text, offset: 0, nextOffset: size, totalBytes: size, endOfStream: true,
    truncated: { head: [0, headEnd], tail: [tailStart, size], omittedBytes: omitted, keyLines } };
}

/** Line numbers count from the search start offset; matched lines also show their byte offset for resuming. */
async function search(source: ReadSource, request: ReadRequest, render: (raw: string) => string, limit: number): Promise<ReadPage> {
  const pattern = compileSearch(request.search!);
  const context = Math.min(request.context ?? READ_LIMITS.defaultContext, READ_LIMITS.maxContext);
  const from = Math.min(request.offset ?? 0, source.size);
  const out: string[] = [], before: string[] = [];
  let matches = 0, lineNumber = 0, after = 0, bytes = 0, nextOffset = source.size, lastPrinted = -1;
  for await (const line of lines(source, from, source.size)) {
    lineNumber++;
    const text = render(line.bytes.toString('utf8'));
    if (pattern.test(text)) {
      if (matches >= READ_LIMITS.maxMatches || bytes >= limit) { nextOffset = line.offset; break; }
      matches++;
      if (lastPrinted >= 0 && lineNumber - before.length > lastPrinted + 1) out.push('--');
      for (const [index, item] of before.entries()) out.push(`${lineNumber - before.length + index}  ${item}`);
      out.push(`${lineNumber}@${line.offset}> ${text}`); bytes += Buffer.byteLength(text);
      before.length = 0; after = context; lastPrinted = lineNumber;
    } else if (after > 0) { out.push(`${lineNumber}  ${text}`); after--; lastPrinted = lineNumber; }
    else { before.push(text); if (before.length > context) before.shift(); }
  }
  return { text: out.join('\n') || `No lines match ${request.search}`, offset: from, nextOffset, totalBytes: source.size,
    endOfStream: nextOffset >= source.size, matches };
}
