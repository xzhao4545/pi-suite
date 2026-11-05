// Trigger compilation, poll-diff loop and file-watch command adapted from pi-interactive-shell
// 0.18.0 index.ts (MIT, third-party/licenses/pi-interactive-shell.txt). pi-suite changes: one
// pattern syntax shared with job_read search; eq threshold; semantic strategy dropped.
import { Type, type Static } from 'typebox';
import { compileSearch } from '../../runtime/read.ts';
import { ToolError } from '../../runtime/errors.ts';
import type { ResolvedShellConfig } from '../terminal/shell.ts';

const ops = ['lt', 'lte', 'gt', 'gte', 'eq'] as const;
export const monitorSchema = Type.Object({
  strategy: Type.Optional(Type.Union([Type.Literal('stream'), Type.Literal('poll-diff'), Type.Literal('file-watch')], { description: 'stream (default) matches each output line; poll-diff reruns command every poll.intervalMs and matches changed output; file-watch watches fileWatch.path instead of running a command' })),
  triggers: Type.Array(Type.Object({
    id: Type.String({ minLength: 1, maxLength: 64 }),
    literal: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
    regex: Type.Optional(Type.String({ minLength: 1, maxLength: 1000, description: '/re/flags, or a bare pattern matched case-insensitively' })),
    threshold: Type.Optional(Type.Object({
      captureGroup: Type.Integer({ minimum: 1 }), value: Type.Number(),
      op: Type.Union([Type.Literal('lt'), Type.Literal('lte'), Type.Literal('gt'), Type.Literal('gte'), Type.Literal('eq')]),
    }, { additionalProperties: false })),
    cooldownMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 86400000 })),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 20 }),
  poll: Type.Optional(Type.Object({ intervalMs: Type.Integer({ minimum: 250, maximum: 3600000 }) }, { additionalProperties: false })),
  fileWatch: Type.Optional(Type.Object({
    path: Type.String({ minLength: 1 }), recursive: Type.Optional(Type.Boolean()),
    events: Type.Optional(Type.Array(Type.Union([Type.Literal('rename'), Type.Literal('change')]), { minItems: 1 })),
  }, { additionalProperties: false })),
  dedupeExactLine: Type.Optional(Type.Boolean({ description: 'Default true: the same line fires a trigger once' })),
  cooldownMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 86400000, description: 'Per-trigger minimum gap; a trigger cooldownMs overrides it' })),
  detector: Type.Optional(Type.Object({
    command: Type.String({ minLength: 1, maxLength: 4096, description: 'Receives the candidate event JSON on stdin; stdout true/false or {"emit":bool,...} decides' }),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 100, maximum: 60000 })),
  }, { additionalProperties: false })),
}, { additionalProperties: false });
export type MonitorInput = Static<typeof monitorSchema>;
export type Strategy = 'stream' | 'poll-diff' | 'file-watch';
export type Trigger = { id: string; cooldownMs?: number; match(text: string): string | undefined };
export type CompiledMonitor = {
  strategy: Strategy; triggers: Trigger[]; pollMs: number; dedupe: boolean; cooldownMs?: number;
  detector?: { command: string; timeoutMs: number };
  /** The command the job actually runs: the caller's, its poll loop, or the generated watcher. */
  command: string;
};

function compare(value: number, op: typeof ops[number], expected: number): boolean {
  return op === 'lt' ? value < expected : op === 'lte' ? value <= expected : op === 'gt' ? value > expected : op === 'gte' ? value >= expected : value === expected;
}
function compileTrigger(trigger: MonitorInput['triggers'][number]): Trigger {
  if ((trigger.literal === undefined) === (trigger.regex === undefined)) throw new ToolError('INVALID_ARGS', `monitor trigger ${trigger.id} needs exactly one of literal or regex`);
  if (trigger.threshold && trigger.regex === undefined) throw new ToolError('INVALID_ARGS', `monitor trigger ${trigger.id}: threshold needs regex`);
  if (trigger.literal !== undefined) {
    const literal = trigger.literal;
    return { id: trigger.id, cooldownMs: trigger.cooldownMs, match: text => text.includes(literal) ? literal : undefined };
  }
  const regex = compileSearch(trigger.regex!), threshold = trigger.threshold;
  return {
    id: trigger.id, cooldownMs: trigger.cooldownMs,
    match(text) {
      const match = regex.exec(text);
      if (!match) return undefined;
      if (!threshold) return match[0];
      // Threshold compares a captured number, e.g. /coverage (\d+)%/ with lt 80.
      const value = Number(match[threshold.captureGroup]);
      return Number.isFinite(value) && compare(value, threshold.op, threshold.value) ? match[0] : undefined;
    },
  };
}

/** Bash single quoting keeps $, backticks and backslashes literal on every platform Pi's Bash runs. */
function shellQuote(value: string): string { return `'${value.replace(/'/g, `'\\''`)}'`; }
function fileWatchCommand(watch: NonNullable<MonitorInput['fileWatch']>): string {
  const script = `const fs=require("node:fs");const allowed=new Set(process.argv[3].split(","));
let watcher;try{watcher=fs.watch(process.argv[1],{recursive:process.argv[2]==="1"},(type,name)=>{if(allowed.has(type))process.stdout.write(type.toUpperCase()+" "+(name?String(name):".")+"\\n");});}
catch(error){console.error("file-watch failed: "+(error instanceof Error?error.message:String(error)));process.exit(1);}
watcher.on("error",error=>{console.error("file-watch error: "+(error instanceof Error?error.message:String(error)));process.exit(1);});
process.stdin.resume();`;
  const encoded = Buffer.from(script, 'utf8').toString('base64');
  return `${shellQuote(process.execPath)} -e "eval(Buffer.from('${encoded}','base64').toString('utf8'))" ${shellQuote(watch.path)} ${watch.recursive ? '1' : '0'} ${shellQuote([...new Set(watch.events ?? ['rename', 'change'])].join(','))}`;
}

export function compileMonitor(input: MonitorInput, command: string | undefined, shell: ResolvedShellConfig): CompiledMonitor {
  const strategy = input.strategy ?? 'stream';
  if (strategy !== 'file-watch' && input.fileWatch) throw new ToolError('INVALID_ARGS', 'monitor.fileWatch needs strategy file-watch');
  if (strategy !== 'poll-diff' && input.poll) throw new ToolError('INVALID_ARGS', 'monitor.poll needs strategy poll-diff');
  if (strategy === 'file-watch' ? command !== undefined || !input.fileWatch : command === undefined) {
    throw new ToolError('INVALID_ARGS', strategy === 'file-watch' ? 'file-watch needs monitor.fileWatch and no command' : 'command is required');
  }
  // A stdin-transport shell (legacy WSL bash) cannot also pipe the candidate JSON to a detector.
  if (input.detector && shell.commandTransport !== 'argv') throw new ToolError('INVALID_ARGS', 'monitor.detector needs a Bash that takes commands as arguments (Git Bash shellPath on Windows)');
  const ids = input.triggers.map(trigger => trigger.id);
  if (new Set(ids).size !== ids.length) throw new ToolError('INVALID_ARGS', 'monitor trigger ids must be unique');
  const pollMs = input.poll?.intervalMs ?? 5000;
  return {
    strategy, triggers: input.triggers.map(compileTrigger), pollMs, dedupe: input.dedupeExactLine !== false, cooldownMs: input.cooldownMs,
    detector: input.detector ? { command: input.detector.command, timeoutMs: input.detector.timeoutMs ?? 3000 } : undefined,
    command: strategy === 'file-watch' ? fileWatchCommand(input.fileWatch!)
      : strategy === 'poll-diff' ? `while true; do ${command}; sleep ${Number((pollMs / 1000).toFixed(3))}; done` : command!,
  };
}
