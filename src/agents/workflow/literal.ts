/**
 * Restrict the metadata fragment to literals before the upstream VM evaluates it.
 * An empty VM alone still permits computations such as (() => 'name')(), which
 * contradict the deterministic metadata contract. Strings keep JavaScript escapes.
 */
export function assertPureLiteral(source: string): void {
  const lexer = /\s+|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\\r\n])*"|'(?:\\[\s\S]|[^'\\\r\n])*'|`(?:\\[\s\S]|[^`\\$]|\$(?!\{))*`|-?(?:0[xX][\da-fA-F]+|0[bB][01]+|0[oO][0-7]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)|[$_\p{ID_Start}][$_\u200c\u200d\p{ID_Continue}]*|[{}\[\]:,]/uy;
  let position = 0;
  function fail(): never { throw new Error(`Expected a pure literal at metadata offset ${position}.`); }
  function next(): string | undefined {
    while (position < source.length) {
      lexer.lastIndex = position;
      const match = lexer.exec(source);
      if (!match) fail();
      position = lexer.lastIndex;
      const text = match[0];
      if (/^\s|^\/\//.test(text) || text.startsWith('/*')) continue;
      return text;
    }
    return undefined;
  }
  let token = next();
  const take = () => { token = next(); };
  function expect(text: string): void {
    if (token !== text) fail();
    take();
  }
  function isString(text: string): boolean { return /^['"`]/.test(text); }
  function isNumber(text: string): boolean { return /^-?[\d.]/.test(text); }
  // Read through a function because recursive parsing advances the current token.
  const current = () => token;
  function value(): void {
    const text = current();
    if (text === '{' || text === '[') {
      const object = text === '{', end = object ? '}' : ']';
      take();
      while (current() !== end) {
        if (object) {
          const key = current();
          if (key === undefined || !(isString(key) || isNumber(key) || /^[$_\p{ID_Start}]/u.test(key))) fail();
          // Template literals are values; JavaScript does not allow them as bare keys.
          if (key.startsWith('`')) fail();
          take(); expect(':');
        }
        value();
        if (current() === end) break;
        expect(',');
      }
      expect(end);
      return;
    }
    if (text === undefined || !(isString(text) || isNumber(text) || ['true', 'false', 'null'].includes(text))) fail();
    take();
  }
  value();
  if (token !== undefined) fail();
}
