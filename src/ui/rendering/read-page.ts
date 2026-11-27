import type { ReadPage } from '../../runtime/read.ts';
import type { ToolField } from '../tool-render.ts';

/** Page offsets describe the raw byte source, not the length of the rendered text. */
export function readPageFields(page: ReadPage & { stream: string }): ToolField[] {
  return [
    { label: 'stream', value: page.stream },
    { label: 'offset', value: String(page.offset) },
    { label: 'nextOffset', value: String(page.nextOffset) },
    { label: 'totalBytes', value: String(page.totalBytes) },
    { label: 'endOfStream', value: String(page.endOfStream) },
    ...page.matches !== undefined ? [{ label: 'matches', value: String(page.matches) }] : [],
    ...page.truncated ? [{ label: 'omittedBytes', value: String(page.truncated.omittedBytes) }] : [],
  ];
}
