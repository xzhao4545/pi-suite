import type { ThemeColor } from '@earendil-works/pi-coding-agent';

export type CommandRole = 'command' | 'keyword' | 'option' | 'type' | 'variable' | 'string' | 'operator' | 'comment' | 'number' | 'punctuation';
export interface CommandSpan { start: number; end: number; role: CommandRole }
export const commandColors: Record<CommandRole, ThemeColor> = {
  command: 'syntaxFunction', keyword: 'syntaxKeyword', option: 'syntaxType', type: 'syntaxType', variable: 'syntaxVariable',
  string: 'syntaxString', operator: 'syntaxOperator', comment: 'syntaxComment', number: 'syntaxNumber', punctuation: 'syntaxPunctuation',
};

/** Both shells scan the original text once; offsets never refer to HTML or generated ANSI. */
export class ShellCursor {
  pos = 0;
  readonly spans: CommandSpan[] = [];
  constructor(readonly code: string) {}
  match(pattern: RegExp): string | undefined {
    // Sticky patterns avoid searching or copying every remaining suffix of a long command.
    pattern.lastIndex = this.pos;
    return pattern.exec(this.code)?.[0];
  }
  emit(end: number, role?: CommandRole): void {
    if (role && end > this.pos) {
      const previous = this.spans.at(-1);
      if (previous?.end === this.pos && previous.role === role) previous.end = end;
      else this.spans.push({start: this.pos, end, role});
    }
    this.pos = end;
  }
}
