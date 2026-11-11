import { ShellCursor, type CommandRole, type CommandSpan } from './spans.ts';

const keywords = new Set(['if', 'else', 'elseif', 'foreach', 'return', 'do', 'while', 'until', 'begin', 'for', 'trap', 'data',
  'dynamicparam', 'end', 'break', 'throw', 'param', 'continue', 'finally', 'in', 'switch', 'exit', 'filter', 'try', 'process',
  'catch', 'hidden', 'static', 'parameter', 'function', 'class', 'enum', 'using']);
const comparisons = new Set(('and or xor not band bnot bor bxor as is isnot in notin contains notcontains ccontains cnotcontains ' +
  'icontains inotcontains eq ne gt ge lt le ceq cne cgt cge clt cle ieq ine igt ige ilt ile like notlike clike cnotlike ilike inotlike ' +
  'match notmatch cmatch cnotmatch imatch inotmatch replace creplace ireplace split csplit isplit join shl shr f').split(' '));

class PowerShellScanner extends ShellCursor {
  sequence(close = '', hashtable = false): void {
    let command = !hashtable, args = false, options = true, target = false, invoke = false;
    while (this.pos < this.code.length) {
      const char = this.code[this.pos];
      if (char === close) { this.emit(this.pos + 1, 'operator'); return; }
      const space = this.match(/[ \t]+/y);
      if (space) { this.emit(this.pos + space.length); continue; }
      if (char === '\n' || char === ';') {
        this.emit(this.pos + 1, char === ';' ? 'operator' : undefined);
        command = !hashtable; args = false; options = true; target = false; invoke = false; continue;
      }
      if (this.code.startsWith('<#', this.pos)) { this.blockComment(); continue; }
      if (char === '#') {
        const end = this.code.indexOf('\n', this.pos);
        this.emit(end < 0 ? this.code.length : end, 'comment'); continue;
      }
      if (this.code.startsWith('`\n', this.pos)) { this.emit(this.pos + 2); continue; }
      if (args && this.code.startsWith('--%', this.pos)) {
        this.emit(this.pos + 3, 'operator');
        const end = this.code.indexOf('\n', this.pos);
        this.emit(end < 0 ? this.code.length : end, 'string'); continue;
      }
      const opening = this.match(/@['"]\n/y);
      if (opening) { const quote = opening[1]; this.emit(this.pos + opening.length, 'string'); this.hereString(quote); command = false; continue; }
      const redirect = this.match(/(?:[1-6]|\*)?(?:>>|>)(?:&[1-6])?/y);
      if (redirect) { this.emit(this.pos + redirect.length, 'operator'); target = !/>&[1-6]$/.test(redirect); continue; }
      if (char === '(' || char === '{' || this.code.startsWith('@(', this.pos) || this.code.startsWith('@{', this.pos)) {
        const grouping = char === '@' ? this.code[this.pos + 1] : char;
        this.emit(this.pos + (char === '@' ? 2 : 1), 'operator'); this.sequence(grouping === '(' ? ')' : '}', char === '@' && grouping === '{');
        command = grouping === '{' && char !== '@'; target = false; continue;
      }
      const separator = this.match(/&&|\|\||\||&/y);
      if (separator) {
        this.emit(this.pos + separator.length, 'operator'); command = true; args = false; options = true; target = false;
        invoke = separator === '&'; continue;
      }
      // Assignment RHS can itself be a command pipeline. '=' inside an argument is consumed by word().
      const assignment = !args && this.match(/(?:\+|-|\*|\/|%|\?\?)?=/y);
      if (assignment) { this.emit(this.pos + assignment.length, 'operator'); command = true; continue; }
      if (!args && char === '[' && /[A-Za-z_]/.test(this.code[this.pos + 1] ?? '')) {
        // Scan an incomplete nested type once, rather than retrying a greedy suffix regex at each '['.
        let depth = 0;
        do { const bracket = this.code[this.pos]; depth += bracket === '[' ? 1 : bracket === ']' ? -1 : 0; this.emit(this.pos + 1, 'type'); }
        while (depth && this.pos < this.code.length);
        command = false; continue;
      }
      const number = this.match(/-?(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?:[kKmMgGtTpP][bB]|[dDlLnN])?\b/y);
      if (number && (!args || !this.code[this.pos + number.length] || /[ \t\n;|&(){}]/.test(this.code[this.pos + number.length]))) {
        this.emit(this.pos + number.length, 'number'); command = false; target = false; continue;
      }
      const bare = this.match(command || args ? /[^ \t\n;|&(){}<>'"`$=]+/y : /-?[A-Za-z_][A-Za-z_0-9-]*/y);
      const whole = bare && (!this.code[this.pos + bare.length] || /[ \t\n;|&(){}<>]/.test(this.code[this.pos + bare.length]));
      if (whole && !target && command && keywords.has(bare.toLowerCase())) {
        this.emit(this.pos + bare.length, 'keyword'); continue;
      }
      if (!args && whole && bare.startsWith('-') && comparisons.has(bare.toLowerCase().slice(1))) {
        this.emit(this.pos + bare.length, 'operator'); continue;
      }
      let role: CommandRole | undefined;
      if (!target && command && char !== '$' && char !== '"' && char !== "'") role = 'command';
      else if (!target && args && options && whole && bare === '--') options = false;
      else if (!target && args && options && this.match(/--?[A-Za-z_][A-Za-z_0-9-]*/y)) role = 'option';
      const start = this.pos;
      this.word(role, args || role === 'command' || invoke, close);
      if (this.pos === start) {
        const operator = this.match(/\+\+|--|\?\?|::|\.\.|[+*/%!,:[\]<>?=-]/y);
        this.emit(this.pos + (operator?.length ?? 1), operator ? 'operator' : undefined);
      } else {
        if (target) target = false;
        else { if (role === 'command' || invoke) args = true; command = false; invoke = false; }
      }
    }
  }

  /** Adjacent quotes/escaped spaces stay in one argument; paths are words, not '/' or ':' expressions. */
  private word(role: CommandRole | undefined, argument: boolean, close: string): void {
    let option = role === 'option';
    while (this.pos < this.code.length) {
      const char = this.code[this.pos];
      if (char === close || /[ \t\n;|&(){}<>]/.test(char)) return;
      if (char === '"' || char === "'") { this.quote(char); continue; }
      if (char === '$' && this.expansion()) continue;
      if (char === '`') { this.emit(Math.min(this.pos + 2, this.code.length), role); continue; }
      if (!argument && /[=,+*/%!:[\]?-]/.test(char)) return;
      if (option && (char === '=' || char === ':')) {
        this.emit(this.pos + 1, 'operator'); option = false; role = undefined; continue;
      }
      const text = this.match(argument ? /[^ \t\n;|&(){}<>'"`$=:]+/y : /[^ \t\n;|&(){}<>'"`$=,+*/%!:[\]?-]+/y);
      this.emit(this.pos + (text?.length ?? 1), role);
    }
  }

  private expansion(): boolean {
    if (this.code.startsWith('$(', this.pos)) { this.emit(this.pos + 2, 'operator'); this.sequence(')'); return true; }
    if (this.code.startsWith('${', this.pos)) {
      const end = this.code.indexOf('}', this.pos + 2);
      this.emit(end < 0 ? this.code.length : end + 1, 'variable'); return true;
    }
    const variable = this.match(/\$(?:[A-Za-z_][A-Za-z_0-9:]*|[0-9]+|[?^$])/y);
    if (!variable) return false;
    this.emit(this.pos + variable.length, /^\$(?:true|false|null)$/i.test(variable) ? 'number' : 'variable'); return true;
  }

  private quote(quote: string): void {
    this.emit(this.pos + 1, 'string');
    while (this.pos < this.code.length) {
      const char = this.code[this.pos];
      if (char === quote) {
        if (this.code[this.pos + 1] === quote) { this.emit(this.pos + 2, 'string'); continue; }
        this.emit(this.pos + 1, 'string'); return;
      }
      if (quote === '"' && char === '`') { this.emit(Math.min(this.pos + 2, this.code.length), 'string'); continue; }
      if (quote === '"' && char === '$' && this.expansion()) continue;
      const text = this.match(quote === "'" ? /[^']+/y : /[^"`$]+/y);
      this.emit(this.pos + (text?.length ?? 1), 'string');
    }
  }

  private blockComment(): void {
    let depth = 1;
    this.emit(this.pos + 2, 'comment');
    while (this.pos < this.code.length) {
      if (this.code.startsWith('<#', this.pos)) { depth++; this.emit(this.pos + 2, 'comment'); }
      else if (this.code.startsWith('#>', this.pos)) { this.emit(this.pos + 2, 'comment'); if (--depth === 0) return; }
      else this.emit(this.pos + 1, 'comment');
    }
  }

  private hereString(quote: string): void {
    while (this.pos < this.code.length) {
      if (this.code[this.pos - 1] === '\n' && this.code.startsWith(`${quote}@`, this.pos)) { this.emit(this.pos + 2, 'string'); return; }
      const char = this.code[this.pos];
      if (quote === '"' && char === '`') { this.emit(Math.min(this.pos + 2, this.code.length), 'string'); continue; }
      if (quote === '"' && char === '$' && this.expansion()) continue;
      const text = this.match(quote === "'" ? /[^\n]+/y : /[^\n`$]+/y);
      this.emit(this.pos + (text?.length ?? 1), 'string');
    }
  }
}

export function scanPowerShell(code: string): CommandSpan[] {
  const scanner = new PowerShellScanner(code);
  scanner.sequence();
  return scanner.spans;
}
