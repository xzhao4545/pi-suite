// Quiet/grace lifecycle and incremental update budgets adapted from pi-interactive-shell
// 0.18.0 headless-monitor.ts and overlay-component.ts (MIT, third-party/licenses/pi-interactive-shell.txt).
// pi-suite keeps supervision in the process-lifetime manager; only a real exit settles a job.
import { performance } from 'node:perf_hooks';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { ToolError } from '../../runtime/errors.ts';
import type { PtyTerminalSession } from '../terminal/session.ts';
import { normalizeVisibleText } from '../terminal/visible-text.ts';

const milliseconds = (description: string, minimum = 1) => Type.Optional(Type.Integer({ minimum, maximum: 86400000, description }));
export const handsFreeSchema = Type.Object({
  mode: Type.Optional(Type.Union([Type.Literal('hands-free'), Type.Literal('dispatch')], { description: 'hands-free (default): progress updates; dispatch: one result after exit or quiet termination' })),
  updateMode: Type.Optional(Type.Union([Type.Literal('onQuiet'), Type.Literal('interval')])),
  quietMs: milliseconds('Output silence threshold, default 8000'),
  updateIntervalMs: milliseconds('Update interval, or maximum wait for continuously arriving output, default 60000'),
  autoExitOnQuiet: Type.Optional(Type.Boolean({ description: 'Request termination on silence after graceMs; defaults true in dispatch, false in hands-free. Silence does not prove success' })),
  graceMs: milliseconds('Startup grace before quiet termination, default 15000', 0),
  updateMaxChars: Type.Optional(Type.Integer({ minimum: 1, maximum: 65536, description: 'Output characters per update, default 1500' })),
  maxTotalChars: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000000, description: 'Total update output budget, default 100000; after exhaustion updates carry only status' })),
}, { additionalProperties: false });
export type HandsFreeInput = Static<typeof handsFreeSchema>;
export type HandsFreeConfig = Required<HandsFreeInput>;
export type HandsFreeUpdate = { updateId: number; at: string; text: string; truncated: boolean; totalCharsSent: number; budgetExhausted: boolean };
export type HandsFreeState = { config: HandsFreeConfig; updates: number; notifiedUpdates: number; totalCharsSent: number };

/** Validate at the manager's start boundary, also used by non-tool callers. */
export function compileHandsFree(input: HandsFreeInput, mode: string): HandsFreeConfig {
  if (mode !== 'pty' || !Value.Check(handsFreeSchema, input)) throw new ToolError('INVALID_ARGS', 'handsFree needs mode pty and valid supervision options');
  return { mode: 'hands-free', updateMode: 'onQuiet', quietMs: 8000, updateIntervalMs: 60000,
    autoExitOnQuiet: input.mode === 'dispatch', graceMs: 15000, updateMaxChars: 1500, maxTotalChars: 100000, ...input };
}

export class HandsFreeSupervisor {
  private started = performance.now();
  private quietTimer?: NodeJS.Timeout;
  private intervalTimer?: NodeJS.Timeout;
  private unsubscribe: () => void;
  private paused = false;
  private disposed = false;
  private tail = '';
  private outputChars = 0;

  constructor(terminal: Pick<PtyTerminalSession, 'onData'>, private state: HandsFreeState,
    private update: (value: HandsFreeUpdate) => void, private quiet: () => void) {
    this.unsubscribe = terminal.onData(data => {
      if (this.paused || this.disposed) return;
      const visible = normalizeVisibleText(data);
      if (!visible) return;
      this.outputChars += visible.length;
      // Keep only one update's tail in memory; full output remains in the job log.
      this.tail = (this.tail + visible).slice(-this.state.config.updateMaxChars);
      if (visible.trim()) this.armQuiet();
    });
    this.resumeTimers();
  }
  private armQuiet(): void {
    clearTimeout(this.quietTimer);
    const config = this.state.config;
    if (config.mode === 'dispatch' && !config.autoExitOnQuiet) return;
    const onQuiet = () => {
      if (this.paused || this.disposed) return;
      const remainingGrace = config.graceMs - (performance.now() - this.started);
      if (config.autoExitOnQuiet && remainingGrace <= 0) {
        this.dispose(); this.quiet(); return;
      }
      if (config.mode === 'hands-free' && config.updateMode === 'onQuiet' && this.outputChars) this.emit();
      if (config.autoExitOnQuiet) {
        // Grace is measured from launch, not from the most recent output or a view reattach.
        this.quietTimer = setTimeout(onQuiet, Math.max(1, Math.ceil(remainingGrace)));
        this.quietTimer.unref();
      }
    };
    this.quietTimer = setTimeout(onQuiet, config.quietMs);
    this.quietTimer.unref();
  }
  private resumeTimers(): void {
    this.armQuiet();
    if (this.state.config.mode === 'dispatch') return;
    this.intervalTimer = setInterval(() => {
      if (this.state.config.updateMode === 'interval' || this.outputChars) this.emit();
    }, this.state.config.updateIntervalMs);
    this.intervalTimer.unref();
  }
  private emit(): void {
    const state = this.state, remaining = Math.max(0, state.config.maxTotalChars - state.totalCharsSent);
    let text = remaining ? this.tail.slice(-remaining) : '';
    // A tail boundary must not expose half of a UTF-16 surrogate pair.
    if (/^[\uDC00-\uDFFF]/.test(text)) text = text.slice(1);
    state.totalCharsSent += text.length;
    const value: HandsFreeUpdate = { updateId: ++state.updates, at: new Date().toISOString(), text,
      truncated: this.outputChars > text.length, totalCharsSent: state.totalCharsSent,
      budgetExhausted: state.totalCharsSent >= state.config.maxTotalChars };
    this.tail = ''; this.outputChars = 0;
    this.update(value);
  }
  /** Model input starts a new quiet window even if the program hasn't echoed it yet. */
  input(): void { if (!this.paused && !this.disposed) this.armQuiet(); }
  /** User control suspends updates and quiet termination; the explicit run timeout still applies. */
  pause(): void {
    this.paused = true; clearTimeout(this.quietTimer); clearInterval(this.intervalTimer);
    this.tail = ''; this.outputChars = 0;
  }
  resume(): void { if (this.disposed || !this.paused) return; this.paused = false; this.resumeTimers(); }
  dispose(): void {
    this.disposed = true; clearTimeout(this.quietTimer); clearInterval(this.intervalTimer); this.unsubscribe();
  }
}
