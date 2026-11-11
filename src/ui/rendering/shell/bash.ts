import { ShellCursor, type CommandRole, type CommandSpan } from './spans.ts';

type HereDoc = {delimiter: string; quoted: boolean; tabs: boolean};
const keywords = new Set(['if', 'then', 'else', 'elif', 'fi', 'for', 'select', 'while', 'until', 'do', 'done', 'case', 'esac', 'function', 'time', '!']);

class BashScanner extends ShellCursor {
  /** A substitution/group gets its own command position and heredoc queue. */
  sequence(close = ''): void {
    let command = true, options = true, target = false;
    let header: 'forName' | 'forIn' | 'forValues' | 'caseWord' | 'caseIn' | 'function' | 'functionBody' | undefined;
    const cases: ('pattern' | 'body')[] = [], docs: HereDoc[] = [];
    while (this.pos < this.code.length) {
      const char = this.code[this.pos];
      if (close && char === close && !(char === ')' && cases.at(-1) === 'pattern')) {
        this.emit(this.pos + 1, 'operator'); return;
      }
      const space = this.match(/[ \t]+/y);
      if (space) { this.emit(this.pos + space.length); continue; }
      if (char === '\n') {
        this.emit(this.pos + 1);
        for (const doc of docs) this.heredoc(doc);
        docs.length = 0; command = true; options = true; target = false;
        if (header === 'forValues') header = undefined;
        continue;
      }
      // Here # is at a word boundary; embedded file#name is consumed by word().
      if (char === '#') {
        const end = this.code.indexOf('\n', this.pos);
        this.emit(end < 0 ? this.code.length : end, 'comment'); continue;
      }
      if (this.code.startsWith('\\\n', this.pos)) { this.emit(this.pos + 2); continue; }
      if (this.code.startsWith('$((', this.pos) || this.code.startsWith('((', this.pos)) {
        const length = char === '$' ? 3 : 2;
        this.emit(this.pos + length, 'operator'); this.expression('))');
        command = false; if (header === 'forName') header = undefined; continue;
      }
      if (this.code.startsWith('[[', this.pos)) {
        this.emit(this.pos + 2, 'operator'); this.expression(']]'); command = false; continue;
      }
      // Process substitutions are words, not redirections with '(' as a target.
      const process = this.code.startsWith('<(', this.pos) || this.code.startsWith('>(', this.pos);
      const redirect = !process && this.match(/(?:[0-9]+|&)?(?:<<<|<<-|<<|>>|<>|>\||>|<)(?:&(?:[0-9]+|-)?)?/y);
      if (redirect) {
        this.emit(this.pos + redirect.length, 'operator');
        if (/<<-?$/.test(redirect)) {
          const whitespace = this.match(/[ \t]+/y);
          if (whitespace) this.emit(this.pos + whitespace.length);
          docs.push(this.delimiter(redirect.endsWith('-')));
          target = false;
        } else target = !/&(?:[0-9]+|-)$/.test(redirect);
        continue;
      }
      if (char === '(' && cases.at(-1) === 'pattern') { this.emit(this.pos + 1, 'operator'); continue; }
      if (char === '(') {
        const empty = this.match(/\([ \t]*\)/y);
        if (empty) { this.emit(this.pos + empty.length, 'operator'); command = true; continue; }
        this.emit(this.pos + 1, 'operator'); this.sequence(')'); command = false; continue;
      }
      if (char === ')' && cases.at(-1) === 'pattern') {
        this.emit(this.pos + 1, 'operator'); cases[cases.length - 1] = 'body'; command = true; continue;
      }
      const separator = this.match(/;;&|;;|;&|&&|\|\||\|&|[;&|]/y);
      if (separator) {
        this.emit(this.pos + separator.length, 'operator');
        if (separator.startsWith(';;') || separator === ';&') cases[cases.length - 1] = 'pattern';
        command = cases.at(-1) !== 'pattern'; options = true; target = false;
        if (header === 'forValues') header = undefined;
        continue;
      }
      const literal = this.match(/[^ \t\n;&|()<>'"\\$`]+/y);
      const whole = literal && (!this.code[this.pos + literal.length] || /[ \t\n;&|()<>]/.test(this.code[this.pos + literal.length]));
      if (whole && !target) {
        if (header === 'forName') {
          this.emit(this.pos + literal.length, 'variable'); header = 'forIn'; continue;
        }
        if (header === 'forIn' && literal === 'in') {
          this.emit(this.pos + literal.length, 'keyword'); header = 'forValues'; continue;
        }
        if (header === 'caseIn' && literal === 'in') {
          this.emit(this.pos + literal.length, 'keyword'); header = undefined; cases.push('pattern'); command = false; continue;
        }
        const patternEnd = cases.at(-1) === 'pattern' && literal === 'esac';
        if ((command || patternEnd || header === 'functionBody' && literal === '{') && (keywords.has(literal) || literal === '{' || literal === '}')) {
          this.emit(this.pos + literal.length, 'keyword');
          if (literal === 'for' || literal === 'select') { header = 'forName'; command = false; }
          else if (literal === 'case') { header = 'caseWord'; command = false; }
          else if (literal === 'function') { header = 'function'; command = false; }
          else if (literal === 'esac') { cases.pop(); command = false; }
          else { command = !['fi', 'done', '}'].includes(literal); header = undefined; }
          options = true; continue;
        }
      }
      const assignment = command && !target && this.match(/[A-Za-z_][A-Za-z_0-9]*\+?=/y);
      if (assignment) {
        const name = assignment.replace(/\+?=$/, '');
        this.emit(this.pos + name.length, 'variable'); this.emit(this.pos + assignment.length - name.length, 'operator');
        this.word(close); continue;
      }
      let role: CommandRole | undefined;
      if (!target && cases.at(-1) !== 'pattern' && !header) {
        if (command) role = 'command';
        else if (options && whole && literal === '--') options = false;
        else if (options && this.match(/--?[A-Za-z_][A-Za-z_0-9-]*/y)) role = 'option';
        else if (whole && /^-?\d+(?:\.\d+)?$/.test(literal)) role = 'number';
      } else if (header === 'function') role = 'command';
      const start = this.pos;
      this.word(close, role);
      if (this.pos === start) this.emit(this.pos + 1); // An unmatched closing token in a partial call remains visible.
      if (target) target = false;
      else if (header === 'caseWord') header = 'caseIn';
      else if (header === 'function') { header = 'functionBody'; command = false; }
      else if (!header && cases.at(-1) !== 'pattern') command = false;
    }
  }

  /** Quote/expansion segments override the containing word's role without recoloring ANSI. */
  private word(close: string, role?: CommandRole): void {
    let optionName = role === 'option';
    while (this.pos < this.code.length) {
      const char = this.code[this.pos];
      if (char === close || /[ \t\n;&|()]/.test(char)) return;
      if (this.code.startsWith('<(', this.pos) || this.code.startsWith('>(', this.pos)) {
        this.emit(this.pos + 2, 'operator'); this.sequence(')'); continue;
      }
      if (char === '<' || char === '>') return;
      if (char === '"' || char === "'") { this.quote(char); continue; }
      if (char === '$' && this.expansion()) continue;
      if (char === '`') { this.emit(this.pos + 1, 'operator'); this.sequence('`'); continue; }
      if (char === '\\') { this.emit(Math.min(this.pos + 2, this.code.length), role); continue; }
      const text = this.match(/[^ \t\n;&|()<>'"\\$`=]+/y);
      if (text) this.emit(this.pos + text.length, optionName ? 'option' : role);
      else {
        // --key=value highlights the name only; the value keeps its own quotes/variables.
        if (char === '=' && optionName) { this.emit(this.pos + 1, 'operator'); optionName = false; role = undefined; }
        else this.emit(this.pos + 1, optionName ? 'option' : role);
      }
    }
  }

  private quote(quote: string, ansi = false): void {
    this.emit(this.pos + 1, 'string');
    while (this.pos < this.code.length) {
      const char = this.code[this.pos];
      if (char === quote) { this.emit(this.pos + 1, 'string'); return; }
      if (char === '\\' && (ansi || quote === '"' && /[$`"\\\n]/.test(this.code[this.pos + 1] ?? ''))) {
        this.emit(Math.min(this.pos + 2, this.code.length), 'string'); continue;
      }
      if (quote === '"' && char === '$' && this.expansion(true)) continue;
      if (quote === '"' && char === '`') { this.emit(this.pos + 1, 'operator'); this.sequence('`'); continue; }
      const text = this.match(quote === "'" && !ansi ? /[^']+/y : quote === "'" ? /[^'\\]+/y : /[^"\\$`]+/y);
      this.emit(this.pos + (text?.length ?? 1), 'string');
    }
  }

  private expansion(inDouble = false): boolean {
    if (this.code.startsWith('$(', this.pos)) {
      const arithmetic = this.code.startsWith('$((', this.pos);
      this.emit(this.pos + (arithmetic ? 3 : 2), 'operator');
      if (arithmetic) this.expression('))'); else this.sequence(')');
      return true;
    }
    if (this.code.startsWith('${', this.pos)) {
      this.emit(this.pos + 2, 'variable');
      let braces = 1;
      while (this.pos < this.code.length) {
        const char = this.code[this.pos];
        if (char === '$' && this.expansion(inDouble)) continue;
        // Single quotes in a double-quoted ${...} default are literal, not a new quoting scope.
        if (char === '"' || char === "'" && !inDouble) { this.quote(char); continue; }
        if (char === '\\') { this.emit(Math.min(this.pos + 2, this.code.length), 'variable'); continue; }
        if (char === '{') braces++;
        this.emit(this.pos + 1, 'variable');
        if (char === '}' && --braces === 0) return true;
      }
      return true;
    }
    if (this.code.startsWith("$'", this.pos) || this.code.startsWith('$"', this.pos)) {
      const quote = this.code[this.pos + 1];
      this.emit(this.pos + 1, 'string'); this.quote(quote, quote === "'"); return true;
    }
    const variable = this.match(/\$(?:[A-Za-z_][A-Za-z_0-9]*|[0-9]+|[?@*#$!_-])/y);
    if (!variable) return false;
    this.emit(this.pos + variable.length, 'variable'); return true;
  }

  /** Test/arithmetic contexts share quoting/expansion, but never claim a bare operand is a program. */
  private expression(close: string): void {
    let depth = 0;
    while (this.pos < this.code.length) {
      if (!depth && this.code.startsWith(close, this.pos)) { this.emit(this.pos + close.length, 'operator'); return; }
      const char = this.code[this.pos];
      if (char === '$' && this.expansion()) continue;
      if (char === '"' || char === "'") { this.quote(char); continue; }
      if (char === '\\') { this.emit(Math.min(this.pos + 2, this.code.length)); continue; }
      if (char === '(' || char === ')') {
        depth += char === '(' ? 1 : -1; this.emit(this.pos + 1, 'operator'); continue;
      }
      const operator = this.match(/(?:-[A-Za-z]+\b|[+*/%<>=!&|^~?:,-]+)/y);
      if (operator) { this.emit(this.pos + operator.length, 'operator'); continue; }
      const number = this.match(/\d+(?:#[A-Za-z_0-9]+|\.\d+)?/y);
      if (number) { this.emit(this.pos + number.length, 'number'); continue; }
      const text = this.match(/[A-Za-z_][A-Za-z_0-9]*/y);
      this.emit(this.pos + (text?.length ?? 1));
    }
  }

  /** Delimiters undergo quote removal, not expansion; queued bodies begin only after the command's LF. */
  private delimiter(tabs: boolean): HereDoc {
    let delimiter = '', quoted = false, quote = '', ansi = false;
    while (this.pos < this.code.length) {
      const char = this.code[this.pos], next = this.code[this.pos + 1];
      if (!quote && /[ \t\n;&|()<>]/.test(char)) break;
      if (!quote && this.code.startsWith("$'", this.pos)) {
        quote = "'"; ansi = true; quoted = true; this.emit(this.pos + 2, 'string');
      } else if (!quote && (char === '"' || char === "'")) { quote = char; quoted = true; this.emit(this.pos + 1, 'string'); }
      else if (quote && char === quote) { quote = ''; ansi = false; this.emit(this.pos + 1, 'string'); }
      else if (char === '\\' && (ansi || quote !== "'")) {
        if (quote === '"' && !/[$`"\\\n]/.test(next ?? '')) { delimiter += char; this.emit(this.pos + 1, 'string'); continue; }
        quoted ||= next !== '\n';
        const escape = ansi && this.match(/\\(?:[abefnrtv\\'"?]|[0-7]{1,3}|x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{1,4}|U[0-9a-fA-F]{1,8})/y);
        if (escape) {
          const value = escape.slice(1), named: Record<string, string> = {a: '\x07', b: '\b', e: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v'};
          const point = /^[0-7]/.test(value) ? parseInt(value, 8) : /^[xuU]/.test(value) ? parseInt(value.slice(1), 16) : undefined;
          delimiter += point === undefined ? named[value] ?? value : point <= 0x10ffff ? String.fromCodePoint(point) : escape;
          this.emit(this.pos + escape.length, 'string');
        } else {
          if (next && next !== '\n') delimiter += ansi ? `\\${next}` : next;
          this.emit(Math.min(this.pos + 2, this.code.length), 'string');
        }
      } else { delimiter += char; this.emit(this.pos + 1, 'string'); }
    }
    return {delimiter, quoted, tabs};
  }

  private heredoc(doc: HereDoc): void {
    const start = this.pos;
    let scan = start, bodyEnd = this.code.length, end = bodyEnd;
    while (scan < this.code.length) {
      const logical: string[] = [];
      const lineStart = scan;
      let continuation: boolean;
      do {
        const newline = this.code.indexOf('\n', scan), lineEnd = newline < 0 ? this.code.length : newline;
        let line = this.code.slice(scan, lineEnd);
        if (doc.tabs) line = line.replace(/^\t+/, '');
        let slashes = 0;
        for (let i = line.length - 1; i >= 0 && line[i] === '\\'; i--) slashes++;
        continuation = !doc.quoted && newline >= 0 && slashes % 2 === 1;
        logical.push(continuation ? line.slice(0, -1) : line);
        scan = newline < 0 ? lineEnd : lineEnd + 1;
      } while (continuation);
      if (logical.join('') === doc.delimiter) { bodyEnd = lineStart; end = scan; break; }
    }
    // Bash gathers the document before expansion. A partial ${...} cannot eat its terminator
    // and the following outer command. The bounded second pass stays linear and owns no cache.
    const body = new BashScanner(this.code.slice(start, bodyEnd));
    body.heredocText(doc.quoted);
    for (const span of body.spans) { this.emit(start + span.start); this.emit(start + span.end, span.role); }
    this.emit(bodyEnd); this.emit(end, 'string');
  }

  private heredocText(quoted: boolean): void {
    if (quoted) { this.emit(this.code.length, 'string'); return; }
    while (this.pos < this.code.length) {
      const char = this.code[this.pos];
      if (char === '$' && this.expansion(true)) continue;
      if (char === '`') { this.emit(this.pos + 1, 'operator'); this.sequence('`'); continue; }
      if (char === '\\' && /[$`\\\n]/.test(this.code[this.pos + 1] ?? '')) {
        this.emit(Math.min(this.pos + 2, this.code.length), 'string'); continue;
      }
      const text = this.match(/[^$`\\]+/y);
      this.emit(this.pos + (text?.length ?? 1), 'string');
    }
  }
}

export function scanBash(code: string): CommandSpan[] {
  const scanner = new BashScanner(code);
  scanner.sequence();
  return scanner.spans;
}
