import type { Theme, ToolRenderers } from '@earendil-works/pi-coding-agent';
import { Text, truncateToWidth } from '@earendil-works/pi-tui';
import { sanitizeText } from '../runtime/text.ts';

export type Tone = 'accent' | 'success' | 'warning' | 'error' | 'dim';
export interface ToolLine {
  icon: string; tone?: Tone; title: string; summary?: string;
  meta?: (string | { text: string; tone: Tone })[]; strike?: boolean; indent?: number;
}
export interface ToolView<A, D> {
  call(args: A): ToolLine;
  collapsed(details: D, args: A, text: string): ToolLine;
  expanded?(details: D, args: A, text: string, theme: Theme): string[];
}
const literal = (text: string) => sanitizeText(text).replace(/\s+/g, ' ').trim();
export function toolLine(theme: Theme, line: ToolLine, width: number): string {
  let title = literal(line.title);
  if (line.strike) title = `\x1b[9m${title}\x1b[29m`;
  const heading = [literal(line.icon), title].filter(Boolean).join(' ');
  return truncateToWidth(' '.repeat(line.indent ?? 0) + [
    line.tone ? theme.fg(line.tone, heading) : heading,
    line.summary && literal(line.summary),
    ...(line.meta ?? []).filter(Boolean).map(item => theme.fg(typeof item === 'string' ? 'dim' : item.tone,
      literal(typeof item === 'string' ? item : item.text))),
  ].filter(Boolean).join(' · '), width);
}
export function stateLine(state: string): Pick<ToolLine, 'icon' | 'tone'> {
  if (['completed', 'answered'].includes(state)) return { icon: '✔', tone: 'success' };
  if (state === 'failed') return { icon: '✘', tone: 'error' };
  if (['stopped', 'skipped', 'cancelled'].includes(state)) return { icon: '⊘', tone: 'warning' };
  if (['timed_out', 'limited'].includes(state)) return { icon: '⏱', tone: 'warning' };
  if (state === 'queued') return { icon: '⧗', tone: 'dim' };
  if (state === 'waiting') return { icon: '?', tone: 'warning' };
  return { icon: '⟳', tone: 'accent' };
}
/** The host owns expansion and mouse regions; self shells own padding and merged rows. */
export function toolRenderers<A, D>(view: ToolView<A, D>): ToolRenderers {
  return {
    renderShell: 'self',
    renderCall(args, theme, ctx) {
      return { invalidate() {}, render(width) {
        if (ctx.state.finished) return [];
        const pad = Math.min(ctx.outputPad, Math.floor(Math.max(0, width - 1) / 2));
        return [' '.repeat(pad) + toolLine(theme, view.call(args as A), width - pad * 2)];
      } };
    },
    renderResult(result, options, theme, ctx) {
      // A partial update replaces the call too, otherwise progress produces two rows.
      ctx.state.finished = true;
      const text = sanitizeText(result.content.filter(item => item.type === 'text').map(item => item.text).join('\n'));
      return { invalidate() {}, render(width) {
        const pad = Math.min(ctx.outputPad, Math.floor(Math.max(0, width - 1) / 2));
        const inner = width - pad * 2;
        const lines = ctx.isError ? [toolLine(theme, { icon: '✘', tone: 'error', title: view.call(ctx.args as A).title }, inner),
          ...new Text(text, 0, 0).render(inner)]
          : options.expanded ? new Text((view.expanded?.(result.details as D, ctx.args as A, text, theme) ?? [text]).join('\n'), 0, 0).render(inner)
          : [toolLine(theme, view.collapsed(result.details as D, ctx.args as A, text), inner)];
        return lines.map(line => ' '.repeat(pad) + line);
      } };
    },
  };
}
