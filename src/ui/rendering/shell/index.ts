import type { Theme, ThemeColor } from '@earendil-works/pi-coding-agent';
import { scanBash } from './bash.ts';
import { scanPowerShell } from './powershell.ts';
import { commandColors, type CommandSpan } from './spans.ts';

export type CommandShell = 'bash' | 'powershell';
export function commandSpans(code: string, shell: CommandShell): CommandSpan[] {
  return shell === 'bash' ? scanBash(code) : scanPowerShell(code);
}

/** Offsets describe sanitized source, never ANSI; plain arguments retain the theme's code foreground. */
export function colorCommand(code: string, spans: CommandSpan[], theme: Theme): string {
  const pieces: string[] = [];
  // Pi resets each physical line; reopen colors for multiline strings/comments before Text wraps them.
  const paint = (text: string, token: ThemeColor) => text.split('\n').map(line => line ? theme.fg(token, line) : '').join('\n');
  let end = 0;
  for (const span of spans) {
    if (span.start > end) pieces.push(paint(code.slice(end, span.start), 'mdCodeBlock'));
    pieces.push(paint(code.slice(span.start, span.end), commandColors[span.role]));
    end = span.end;
  }
  if (end < code.length) pieces.push(paint(code.slice(end), 'mdCodeBlock'));
  return pieces.join('');
}
