import { performance } from 'node:perf_hooks';
import { getLanguageFromPath, type Theme, type ThemeColor, type ToolRenderers } from '@earendil-works/pi-coding-agent';
import { Container, Text, truncateToWidth, type Component } from '@earendil-works/pi-tui';
import { sanitizeText } from '../runtime/text.ts';
import { stateTone } from './browser-chrome.ts';
import { CodeComponent, commandComponent, type CodeSource, type CommandShell } from './rendering/command.ts';

export type Tone = ThemeColor;
export interface ToolLine {
  icon: string; tone?: Tone; title: string; titleTone?: Tone; summary?: string;
  meta?: (string | { text: string; tone: Tone })[]; strike?: boolean; indent?: number;
}
/** Labels are chrome; values remain literal, multiline text unless explicitly typed as code. */
export interface ToolField { label: string; value: string; tone?: Tone }
export type ToolCode = { code: string; label?: string } & ({ language: string; path?: never } | { path: string; language?: never });
export interface ToolCommand { command: string; shell: CommandShell; label?: string }
export type ToolExpandedRow = string | ToolLine | ToolField | ToolCode | ToolCommand | Component;
export type ToolExpansion = ToolExpandedRow[] | Component;
export interface ToolView<A, D> {
  call(args: A): ToolLine;
  collapsed(details: D, args: A, text: string): ToolLine;
  /** Sensitive fields can be echoed by diagnostics; transform text before expansion/error display. */
  redact?(args: A, text: string, isError: boolean): string;
  /** A tool can label a rejection and supply its diagnostic separately from model guidance. */
  error?(details: D | undefined): { summary: string; diagnostic?: string };
  /** Components are trusted presentation; their producer sanitizes input before generating ANSI. */
  expanded?(details: D, args: A, text: string, theme: Theme): ToolExpansion;
}
const literal = (text: string) => sanitizeText(text).replace(/\s+/g, ' ').trim();
function lineText(theme: Theme, line: ToolLine): string {
  let title = literal(line.title);
  if (line.strike) title = `\x1b[9m${title}\x1b[29m`;
  const heading = [line.icon && theme.fg(line.tone ?? 'accent', literal(line.icon)),
    title && theme.fg(line.titleTone ?? 'toolTitle', title)].filter(Boolean).join(' ');
  return ' '.repeat(line.indent ?? 0) + [
    heading,
    line.summary && theme.fg('toolOutput', literal(line.summary)),
    ...(line.meta ?? []).filter(Boolean).map(item => theme.fg(typeof item === 'string' ? 'dim' : item.tone,
      literal(typeof item === 'string' ? item : item.text))),
  ].filter(Boolean).join(' · ');
}
export function toolLine(theme: Theme, line: ToolLine, width: number): string {
  return truncateToWidth(lineText(theme, line), width);
}
const bodyLine = (theme: Theme, line: ToolLine): Component => new Text(lineText(theme, line), 0, 0);
export function stateLine(state: string): Pick<ToolLine, 'icon' | 'tone'> {
  const icon = ['completed', 'answered'].includes(state) ? '✔' : state === 'failed' ? '✘'
    : ['stopped', 'skipped', 'cancelled'].includes(state) ? '⊘' : ['timed_out', 'limited'].includes(state) ? '⏱'
    : state === 'queued' ? '⧗' : state.startsWith('waiting') ? '?' : '⟳';
  return { icon, tone: stateTone(state) ?? (state === 'answered' ? 'success' : ['skipped', 'cancelled'].includes(state) ? 'dim' : 'accent') };
}
const plainText = (theme: Theme, text: string, tone: Tone = 'toolOutput') =>
  new Text(sanitizeText(text).split('\n').map(line => theme.fg(tone, line)).join('\n'), 0, 0);

/** Body only: the host owns background, padding, expansion, mouse regions and images. */
class ToolBody implements Component {
  private content?: Container;
  private codes = new Map<number, CodeComponent>();
  private caption!: ToolLine;
  private rows?: () => ToolExpansion;
  private theme!: Theme;
  private visible?: () => boolean;
  update(caption: ToolLine, rows: (() => ToolExpansion) | undefined, theme: Theme, visible?: () => boolean): void {
    this.caption = caption; this.rows = rows; this.theme = theme; this.visible = visible;
    this.content = undefined;
  }
  invalidate(): void { this.content?.invalidate(); this.content = undefined; for (const code of this.codes.values()) code.invalidate(); }
  private body(): Container {
    if (this.content) return this.content;
    const content = new Container(), expanded = this.rows?.();
    const rows = expanded === undefined ? [] : Array.isArray(expanded) ? expanded : [expanded];
    rows.forEach((row, index) => {
      if (typeof row === 'string') content.addChild(plainText(this.theme, row));
      else if ('render' in row) content.addChild(row);
      else if ('command' in row || 'code' in row) {
        const language = 'command' in row ? row.shell : row.language ?? getLanguageFromPath(row.path);
        if (row.label) content.addChild(plainText(this.theme, `${row.label}:`, 'muted'));
        const source = 'command' in row ? row.command : row.code;
        if (language) {
          const spec: CodeSource = 'command' in row ? { code: source, language: row.shell, mode: 'command', theme: this.theme }
            : { code: source, language, theme: this.theme };
          const code = this.codes.get(index) ?? ('command' in row
            ? commandComponent(source, row.shell, this.theme) as CodeComponent : new CodeComponent(spec));
          code.setSource(spec); this.codes.set(index, code); content.addChild(code);
        } else content.addChild(plainText(this.theme, source)); // A real path with no grammar is literal, not auto-detected.
      } else if ('label' in row) {
        const label = this.theme.fg('muted', `${literal(row.label)}: `);
        const value = sanitizeText(row.value).split('\n').map(line => this.theme.fg(row.tone ?? 'toolOutput', line));
        content.addChild(new Text(label + value.join('\n'), 0, 0));
      } else content.addChild(bodyLine(this.theme, row));
    });
    for (const index of this.codes.keys()) if (index >= rows.length) this.codes.delete(index);
    this.content = content; return content;
  }
  render(width: number): string[] {
    if (this.visible && !this.visible()) return [];
    return [...this.rows ? bodyLine(this.theme, this.caption).render(width)
      : [toolLine(this.theme, this.caption, width)], ...this.body().render(width)];
  }
}
// A session switch can discard a row without delivering a result. The renderer state
// owns the callback; the interval must not keep the discarded host row alive.
function redrawTimer(invalidate: WeakRef<() => void>): NodeJS.Timeout {
  const timer = setInterval(() => {
    const redraw = invalidate.deref();
    if (redraw) redraw(); else clearInterval(timer);
  }, 1000).unref();
  return timer;
}

/** Shared state hides the call body once any result arrives, leaving one summary in the native Box. */
export function toolRenderers<A, D>(view: ToolView<A, D>, { timing }: { timing?: (ms: number) => string } = {}): ToolRenderers {
  // Duration is the last meta item so it stays next to the summary instead of drifting to the far edge.
  const timed = (caption: ToolLine, ms?: number): ToolLine => timing && ms !== undefined
    ? { ...caption, meta: [...caption.meta ?? [], { text: timing(ms), tone: 'dim' }] } : caption;
  const live = (state: { startedAt?: number }) => state.startedAt === undefined ? undefined : performance.now() - state.startedAt;
  return {
    renderCall(args, theme, ctx) {
      const body = ctx.lastComponent instanceof ToolBody ? ctx.lastComponent : new ToolBody();
      // The host builds the call slot before the result slot; defer visibility until render.
      if (timing && ctx.executionStarted && !ctx.state.finished && ctx.state.startedAt === undefined) {
        ctx.state.startedAt = performance.now();
        ctx.state.invalidate = ctx.invalidate;
        ctx.state.timer = redrawTimer(new WeakRef(ctx.invalidate));
      }
      body.update(timed(view.call(args as A), live(ctx.state)), undefined, theme, () => !ctx.state.finished);
      return body;
    },
    renderResult(result, options, theme, ctx) {
      // Partial output takes over immediately, not only after execution finishes.
      ctx.state.finished = true;
      if (timing && !options.isPartial) {
        clearInterval(ctx.state.timer);
        ctx.state.timer = ctx.state.invalidate = undefined;
      }
      const details = result.details as D, args = ctx.args as A;
      const error = ctx.isError ? view.error?.(details) : undefined;
      const raw = sanitizeText(error?.diagnostic ?? result.content.filter(item => item.type === 'text').map(item => item.text).join('\n'));
      const text = view.redact?.(args, raw, ctx.isError) ?? raw;
      const body = ctx.lastComponent instanceof ToolBody ? ctx.lastComponent : new ToolBody();
      // Expanded errors show the full diagnostic below, so the caption repeats only a tool-supplied label.
      const errorSummary = error?.summary ?? (options.expanded ? undefined : text.split('\n', 1)[0]);
      const caption = ctx.isError ? { icon: '✘', tone: 'error' as const, title: view.call(args).title,
        meta: errorSummary ? [{ text: errorSummary, tone: 'error' as const }] : [] }
        : view.collapsed(details, args, text);
      body.update(timed(caption, options.isPartial ? live(ctx.state) : ctx.durationMs), !options.expanded ? undefined
        : ctx.isError ? () => [plainText(theme, text, 'error')]
        : () => view.expanded?.(details, args, text, theme) ?? [text], theme);
      return body;
    },
  };
}
