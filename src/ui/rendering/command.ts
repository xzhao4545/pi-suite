import { highlightCode, type Theme } from '@earendil-works/pi-coding-agent';
import { Text, type Component } from '@earendil-works/pi-tui';
import { sanitizeText } from '../../runtime/text.ts';
import { colorCommand, commandSpans, type CommandShell } from './shell/index.ts';
import type { CommandSpan } from './shell/spans.ts';

export type { CommandShell } from './shell/index.ts';
export type CodeSource = {
  code: string; theme: Theme;
  /** Trusted UI chrome, not part of the source passed to the grammar. */
  prefix?: string; suffix?: string;
} & ({mode?: 'code'; language: string} | {mode: 'command'; language: CommandShell});

/** One owner keeps one source/layout cache; invalidate rebuilds ANSI after a theme change. */
export class CodeComponent implements Component {
  private source?: CodeSource;
  private text?: Text;
  private width?: number;
  private lines?: readonly string[];
  private palette?: string;
  private tokens?: CommandSpan[];
  constructor(source: CodeSource) { this.setSource(source); }
  setSource(source: CodeSource): void {
    const old = this.source;
    if (old?.code === source.code && old.language === source.language && old.mode === source.mode && old.theme === source.theme &&
      old.prefix === source.prefix && old.suffix === source.suffix) return;
    if (old?.code !== source.code || old.language !== source.language || old.mode !== source.mode) this.tokens = undefined;
    this.source = source;
    this.invalidate();
  }
  invalidate(): void { this.text = undefined; this.lines = undefined; this.width = undefined; }
  render(width: number): readonly string[] {
    const source = this.source!;
    // Pi supplies a live Theme proxy: identity alone cannot detect palette changes.
    const palette = ['syntaxKeyword', 'syntaxString', 'syntaxVariable', 'syntaxComment', 'syntaxNumber',
      'syntaxFunction', 'syntaxType', 'syntaxOperator', 'syntaxPunctuation', 'mdCodeBlock', 'text', 'muted']
      .map(token => source.theme.fg(token as Parameters<Theme['fg']>[0], '')).join('');
    if (palette !== this.palette) { this.invalidate(); this.palette = palette; }
    if (!this.text) {
      const code = sanitizeText(source.code);
      let highlighted: string;
      if (source.mode === 'command') {
        // Keep lexical offsets independent of the theme/layout. In particular <<- needs real tabs.
        this.tokens ??= commandSpans(code, source.language);
        highlighted = colorCommand(code, this.tokens, source.theme);
      } else highlighted = highlightCode(code.replace(/\t/g, '    '), source.language).join('\n');
      this.text = new Text((source.prefix ?? '') + highlighted.replace(/\t/g, '    ') + (source.suffix ?? ''), 0, 0);
    }
    if (!this.lines || this.width !== width) { this.width = width; this.lines = this.text.render(width); }
    return this.lines;
  }
}

/** Jobs and Suite command fields always highlight; only model-tool callers apply the config switch.
 * Keep the returned component for unchanged commands; invalidate it on theme/layout invalidation.
 * Shell is the execution language, never guessed from command contents. No command is executed.
 */
export function commandComponent(command: string, shell: CommandShell, theme: Theme): Component {
  return new CodeComponent({ code: command, language: shell, mode: 'command', theme });
}
