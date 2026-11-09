import { DynamicBorder, getLanguageFromPath, type Theme, type ThemeColor, type ToolRenderers } from '@earendil-works/pi-coding-agent';
import { Container, Text, truncateToWidth, type Component } from '@earendil-works/pi-tui';
import { sanitizeText } from '../runtime/text.ts';
import { stateTone } from './browser-chrome.ts';
import { CodeComponent, commandComponent, type CommandShell } from './rendering/command.ts';

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
export function stateLine(state: string): Pick<ToolLine, 'icon' | 'tone'> {
  const icon = ['completed', 'answered'].includes(state) ? '✔' : state === 'failed' ? '✘'
    : ['stopped', 'skipped', 'cancelled'].includes(state) ? '⊘' : ['timed_out', 'limited'].includes(state) ? '⏱'
    : state === 'queued' ? '⧗' : state.startsWith('waiting') ? '?' : '⟳';
  return { icon, tone: stateTone(state) ?? (state === 'answered' ? 'success' : ['skipped', 'cancelled'].includes(state) ? 'dim' : 'accent') };
}
const plainText = (theme: Theme, text: string, tone: Tone = 'toolOutput') =>
  new Text(sanitizeText(text).split('\n').map(line => theme.fg(tone, line)).join('\n'), 0, 0);

/** Presentation only. ToolExecutionComponent still owns expansion, mouse regions and images. */
class ToolShell implements Component {
  private content?: Container;
  private codes = new Map<number, CodeComponent>();
  private caption!: ToolLine;
  private rows?: () => ToolExpansion;
  private theme!: Theme;
  private pad = 0;
  private visible?: () => boolean;
  update(caption: ToolLine, rows: (() => ToolExpansion) | undefined, theme: Theme, pad: number, visible?: () => boolean): void {
    this.caption = caption; this.rows = rows; this.theme = theme; this.pad = pad; this.visible = visible;
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
          const spec = { code: source, language, theme: this.theme };
          const code = this.codes.get(index) ?? ('command' in row
            ? commandComponent(source, row.shell, this.theme) as CodeComponent : new CodeComponent(spec));
          code.setSource(spec); this.codes.set(index, code); content.addChild(code);
        } else content.addChild(plainText(this.theme, source)); // A real path with no grammar is literal, not auto-detected.
      } else if ('label' in row) {
        const label = this.theme.fg('muted', `${literal(row.label)}: `);
        const value = sanitizeText(row.value).split('\n').map(line => this.theme.fg(row.tone ?? 'toolOutput', line));
        content.addChild(new Text(label + value.join('\n'), 0, 0));
      } else content.addChild(new Text(lineText(this.theme, row), 0, 0));
    });
    for (const index of this.codes.keys()) if (index >= rows.length) this.codes.delete(index);
    this.content = content; return content;
  }
  render(width: number): string[] {
    if (this.visible && !this.visible()) return [];
    const pad = Math.min(this.pad, Math.floor(Math.max(0, width - 1) / 2)), inner = width - pad * 2;
    const border = new DynamicBorder(text => this.theme.fg('borderMuted', text)).render(width);
    const body = [...this.rows ? new Text(lineText(this.theme, this.caption), 0, 0).render(inner)
      : [toolLine(this.theme, this.caption, inner)], ...this.body().render(inner)];
    return [...border, ...body.map(line => ' '.repeat(pad) + line), ...border];
  }
}
/** The host shares finished across call/result updates; the result takes over the one execution shell. */
export function toolRenderers<A, D>(view: ToolView<A, D>): ToolRenderers {
  return {
    renderShell: 'self',
    renderCall(args, theme, ctx) {
      const shell = ctx.lastComponent instanceof ToolShell ? ctx.lastComponent : new ToolShell();
      shell.update(view.call(args as A), undefined, theme, ctx.outputPad, () => !ctx.state.finished);
      return shell;
    },
    renderResult(result, options, theme, ctx) {
      // A partial update replaces the call too, otherwise progress produces two execution frames.
      ctx.state.finished = true;
      const raw = sanitizeText(result.content.filter(item => item.type === 'text').map(item => item.text).join('\n'));
      const text = view.redact?.(ctx.args as A, raw, ctx.isError) ?? raw;
      const shell = ctx.lastComponent instanceof ToolShell ? ctx.lastComponent : new ToolShell();
      const caption = ctx.isError ? { icon: '✘', tone: 'error' as const, title: view.call(ctx.args as A).title }
        : view.collapsed(result.details as D, ctx.args as A, text);
      shell.update(caption, ctx.isError ? () => [plainText(theme, text, 'error')]
        : options.expanded ? () => view.expanded?.(result.details as D, ctx.args as A, text, theme) ?? [text] : undefined,
      theme, ctx.outputPad);
      return shell;
    },
  };
}
