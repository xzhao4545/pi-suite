import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import type { Theme } from '@earendil-works/pi-coding-agent';
import { displayText, type DisplayText } from '../browser-chrome.ts';

/** The domain orders metric omissions; the shared UI decides which suffix fits a real cell. */
export function executionRow(name: string, suffix: DisplayText, compactSuffixes: readonly DisplayText[] | undefined, width: number, theme?: Theme): string {
  const suffixes = [suffix, ...compactSuffixes ?? []].map(value => displayText(value, theme));
  const nameSpace = compactSuffixes ? Math.min(8, visibleWidth(name)) + 1 : 0;
  const tail = truncateToWidth(suffixes.find(text => visibleWidth(text) <= width - nameSpace) ?? suffixes.at(-1)!, width);
  if (!tail) return truncateToWidth(name, width);
  const titleWidth = Math.max(0, width - visibleWidth(tail) - 1);
  const text = truncateToWidth(name, titleWidth, '…');
  return (titleWidth ? text + ' '.repeat(titleWidth - visibleWidth(text) + 1) : '') + tail;
}
