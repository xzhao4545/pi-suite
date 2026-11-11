import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandSpans, type CommandShell } from '../../src/ui/rendering/shell/index.ts';
import type { CommandRole } from '../../src/ui/rendering/shell/spans.ts';

function tokens(code: string, shell: CommandShell = 'bash') {
  const spans = commandSpans(code, shell);
  let end = 0;
  for (const span of spans) {
    assert.ok(span.start >= end && span.end > span.start && span.end <= code.length, 'ordered non-overlapping source offsets');
    end = span.end;
  }
  return spans.map(span => [span.role, code.slice(span.start, span.end)] as const);
}
function has(rows: ReturnType<typeof tokens>, role: CommandRole, text: string) {
  assert.ok(rows.some(([kind, value]) => kind === role && value === text), `${role}: ${JSON.stringify(text)} missing in ${JSON.stringify(rows)}`);
}

test('Bash highlights execution positions, not CLI values or builtin-looking options', () => {
  const rows = tokens('FOO=bar >build.log node --mode=production 2>&1 | head -n 1; pnpm exec tsc --noEmit && git diff --stat');
  for (const text of ['node', 'head', 'pnpm', 'git']) has(rows, 'command', text);
  for (const text of ['--mode', '-n', '--noEmit', '--stat']) has(rows, 'option', text);
  has(rows, 'variable', 'FOO'); has(rows, 'operator', '2>&1'); has(rows, 'operator', '|'); has(rows, 'operator', '&&');
  assert.ok(!rows.some(([role, text]) => role === 'command' && ['bar', 'build.log', 'production', 'exec', 'tsc', 'diff', 'stat'].includes(text)));
  const argumentsOnly = tokens('printf if -- -name -12 file#name "--flag | #"');
  assert.equal(argumentsOnly.filter(([role]) => role === 'command').length, 1);
  assert.equal(argumentsOnly.filter(([role]) => role === 'option' || role === 'keyword' || role === 'comment').length, 0);
  has(argumentsOnly, 'number', '-12'); has(argumentsOnly, 'string', '"--flag | #"');
  const control = tokens('f() { for x in if then; do rg "$x"; done; }; case "$x" in *.ts|*.js) node -v;; *) printf none;; esac');
  for (const text of ['f', 'rg', 'node', 'printf']) has(control, 'command', text);
  for (const text of ['for', 'in', 'do', 'done', 'case', 'esac']) has(control, 'keyword', text);
  assert.equal(tokens('for x; do node -v; done').filter(([role]) => role === 'command').length, 1);
  has(tokens('function f { node --version; }'), 'command', 'node');
  const patterns = tokens('case x in (if) node --version;; esac');
  has(patterns, 'command', 'node'); has(patterns, 'option', '--version');
  assert.ok(!patterns.some(([role, text]) => ['command', 'keyword'].includes(role) && ['if', 'x'].includes(text)));
});

test('Bash quotes, nested expressions, heredocs and partial input keep their own lexical contexts', () => {
  const rows = tokens('printf \'$HOME | --flag\' "$(rg -n "$HOME" | head -1)" ${x:-$(printf ok)} $((1 + (2 * 3))) \\| file#name # comment');
  has(rows, 'string', "'$HOME | --flag'"); has(rows, 'variable', '$HOME'); has(rows, 'command', 'rg'); has(rows, 'command', 'head');
  has(rows, 'operator', '$(('); has(rows, 'number', '2'); has(rows, 'comment', '# comment');
  assert.equal(rows.filter(([role, text]) => role === 'operator' && text === '|').length, 1, 'escaped and quoted pipes are literal');
  const code = 'cat <<EOF <<\'END\'\n$HOME --flag | raw\nEOF\n$HOME --flag | raw\nEND\nnode --version';
  const docs = tokens(code);
  assert.equal(docs.filter(([role, text]) => role === 'variable' && text === '$HOME').length, 1);
  assert.equal(docs.filter(([role]) => role === 'option').length, 1, 'heredoc contents are not command arguments');
  has(docs, 'command', 'node');
  has(tokens('cat <<-EOF\n\t$HOME\n\tEOF\nnode -v'), 'command', 'node');
  has(tokens('printf $\'escaped\\\' --flag\' "line\n$HOME"'), 'variable', '$HOME');
  assert.ok(tokens('printf "${missing:-\'$HOME\'}"').some(([role, text]) => role === 'variable' && text.includes('$HOME')), 'literal single quotes in double-quoted defaults do not suppress interpolation');
  for (const delimiter of ['"E\\OF"', "$'EOF'", "$'E\\x4fF'"]) {
    const end = delimiter === '"E\\OF"' ? 'E\\OF' : 'EOF';
    has(tokens(`cat <<${delimiter}\nbody\n${end}\nnode --version`), 'command', 'node');
  }
  const continued = tokens('cat <<EOF\nprefix\\\nEOF\nstill body\nEOF\nnode --version');
  has(continued, 'command', 'node');
  assert.ok(!continued.some(([role, text]) => role === 'command' && text === 'still'));
  has(tokens('cat <<EOF\nbody\nE\\\nOF\nnode -v'), 'command', 'node');
  has(tokens('cat <<EOF\n${unfinished\nEOF\nnode -v'), 'command', 'node');
  for (const partial of ['printf "--flag | $HOME', 'printf "$(rg -n "x', 'cat <<EOF\n--flag | raw', 'printf ${name:-value']) {
    const spans = tokens(partial);
    assert.ok(!spans.some(([role, text]) => role === 'command' && ['raw', 'value', '--flag'].includes(text)));
  }
});

test('PowerShell preserves cmdlets, parameters and interpolation with its own expression/string boundaries', () => {
  const rows = tokens('Get-ChildItem -Path ./src -Recurse | Select-String -Pattern "theme"; & node --version; $name = "world"; if ($name -eq "world") { Write-Host "$env:HOME $name" }', 'powershell');
  for (const text of ['Get-ChildItem', 'Select-String', 'node', 'Write-Host']) has(rows, 'command', text);
  for (const text of ['-Path', '-Recurse', '-Pattern', '--version']) has(rows, 'option', text);
  has(rows, 'variable', '$env:HOME'); has(rows, 'operator', '-eq'); has(rows, 'keyword', 'if');
  const quotes = tokens("Write-Host '$HOME | --flag it''s' `| file#name <# -Flag | #> # comment", 'powershell');
  assert.equal(quotes.filter(([role]) => role === 'variable' || role === 'option').length, 0);
  assert.equal(quotes.filter(([role]) => role === 'comment').length, 2);
  const here = tokens('$x = @"\n$HOME -Flag | raw\n"@\n$y = @\'\n$HOME -Flag | raw\n\'@\nWrite-Host $x', 'powershell');
  assert.equal(here.filter(([role, text]) => role === 'variable' && text === '$HOME').length, 1);
  has(here, 'command', 'Write-Host');
  const stop = tokens('node --% --flag $HOME | raw\nWrite-Host -1', 'powershell');
  assert.equal(stop.filter(([role]) => role === 'command').length, 2);
  assert.ok(!stop.some(([role, text]) => role === 'option' && text === '--flag'));
  const assigned = tokens('$items = Get-ChildItem -Path ./src -Recurse; node --eval=1 --version; & C:\\tools\\node.exe --version; & ./node -v', 'powershell');
  for (const text of ['Get-ChildItem', 'C:\\tools\\node.exe', './node']) has(assigned, 'command', text);
  has(assigned, 'option', '-Path'); has(assigned, 'option', '--version');
  assert.ok(!assigned.some(([role, text]) => role === 'operator' && ['/', ':'].includes(text)));
  for (const code of ['Write-Host foo` --flag', "Write-Host 'foo'--flag"]) {
    assert.ok(!tokens(code, 'powershell').some(([role]) => role === 'option'), 'adjacent segments remain one argument');
  }
  has(tokens('& "node" --version', 'powershell'), 'option', '--version');
  assert.ok(!tokens('node -- -eq', 'powershell').some(([role, text]) => ['option', 'operator'].includes(role) && text === '-eq'));
  const table = tokens("$x = @{Name='world'; Value=Get-Item -Path ./src}", 'powershell');
  has(table, 'command', 'Get-Item');
  assert.ok(!table.some(([role, text]) => role === 'command' && ['Name', 'Value'].includes(text)));
  tokens('Write-Host ' + '[A'.repeat(10000), 'powershell');
  tokens('[A'.repeat(10000), 'powershell');
  const expression = tokens('$x + ' + 'a+'.repeat(10000) + '1', 'powershell');
  assert.ok(!expression.some(([role]) => role === 'command'), 'expression operands do not enter command mode');
  for (const partial of ['Write-Host "--flag | $HOME', '$x = @"\n-Flag | raw', 'Write-Host $(Get-ChildItem -Path "']) tokens(partial, 'powershell');
});
