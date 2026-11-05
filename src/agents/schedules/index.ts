// Timer dispatch and lifecycle adapted from @tintinweb/pi-subagents 0.23.0
// src/schedule.ts/index.ts (MIT). Runs keep the shared Manager/notification path.
import { randomBytes } from 'node:crypto';
import { Cron } from 'croner';
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { Binding, SessionBinding } from '../../runtime/binding.ts';
import type { Notifications } from '../../runtime/notifications.ts';
import type { SuiteConfig } from '../../runtime/config.ts';
import { ToolError } from '../../runtime/errors.ts';
import type { AgentsModule } from '../index.ts';
import type { StartAgent } from '../types.ts';
import { resolveType } from '../catalog.ts';
import { parseSchedule, nextOccurrence } from './parse.ts';
import { ScheduleStore, schedulePath, type ScheduledAgent } from './store.ts';

type Activation = { binding: Binding; store: ScheduleStore; controller: AbortController };
export class AgentScheduler {
  private crons = new Map<string, Cron>();
  private timers = new Map<string, NodeJS.Timeout>();
  private pending = new Set<Promise<void>>();
  private activation?: Activation;
  constructor(private pi: ExtensionAPI, private binding: SessionBinding, private agents: AgentsModule,
    private notices: Notifications, private config: () => SuiteConfig) {}
  get isActive(): boolean { return Boolean(this.activation); }
  list(): ScheduledAgent[] { return this.activation?.store.current.jobs ?? []; }
  async bind(): Promise<void> {
    this.stop();
    if (!this.config().agents.scheduling || !this.binding.current) return;
    const binding = this.binding.current;
    const activation = { binding, store: new ScheduleStore(schedulePath(getAgentDir(), binding.sessionId)), controller: new AbortController() };
    this.activation = activation;
    try {
      const { jobs } = await activation.store.snapshot();
      if (!this.current(activation)) return;
      for (const job of jobs) {
        if (!job.enabled) continue;
        if (Date.parse(job.nextRun!) <= Date.now()) {
          // Downtime has no dispatch context: skip missed recurring occurrences and report
          // expired one-shots instead of replaying model work when a session is reopened.
          const nextRun = nextOccurrence(job, Date.now());
          await activation.store.update(job.id, { nextRun, enabled: Boolean(nextRun),
            ...nextRun ? {} : { lastStatus: 'error', lastError: 'Scheduled time passed while the session was inactive' } }, activation.controller.signal);
          if (!nextRun) this.error(activation, job.id, job.nextRun!, 'Scheduled time passed while the session was inactive');
        }
      }
      for (const job of activation.store.current.jobs) this.arm(activation, job);
      this.pi.events.emit('subagents:scheduler_ready', { sessionId: binding.sessionId, jobCount: activation.store.current.jobs.length });
    } catch (error) { if (!activation.controller.signal.aborted) { this.stop(); throw error; } }
  }
  stop(): void {
    this.activation?.controller.abort(); this.activation = undefined;
    for (const cron of this.crons.values()) cron.stop(); this.crons.clear();
    for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear();
  }
  /** Quit stops admitted children first, then joins their captured schedule-file updates. */
  async drain(): Promise<void> { await Promise.all([...this.pending]); }
  private current(activation: Activation): boolean {
    return this.activation === activation && this.binding.isCurrent(activation.binding) && !activation.controller.signal.aborted;
  }
  async add(request: StartAgent, schedule: string, ctx: ExtensionContext, signal?: AbortSignal): Promise<ScheduledAgent> {
    const activation = this.activation;
    if (!activation || !this.current(activation) || ctx.sessionManager.getSessionId() !== activation.binding.sessionId) throw new ToolError('STALE_BINDING', 'Scheduler is not bound to this session');
    if (request.background === false || request.inheritContext !== undefined) throw new ToolError('INVALID_ARGS', 'schedule cannot be combined with background:false or inheritContext');
    const type = resolveType(ctx.cwd, request.type ?? 'general-purpose', { trusted: ctx.isProjectTrusted(), packageGate: this.config().agents.packageAgents });
    const spec = parseSchedule(schedule), now = Date.now();
    const { background: _background, inheritContext: _context, ...options } = request;
    const job: ScheduledAgent = { id: `schedule_${randomBytes(4).toString('hex')}`, name: request.name?.trim() || `${type.name}: ${request.prompt.replace(/\s+/g, ' ').slice(0, 40)}`.slice(0, 80),
      ...spec, request: { ...options, type: type.name }, enabled: true, createdAt: new Date(now).toISOString(), runCount: 0,
      nextRun: spec.scheduleType === 'once' ? spec.schedule : nextOccurrence(spec, now) };
    const combined = signal ? AbortSignal.any([signal, activation.controller.signal]) : activation.controller.signal;
    await activation.store.add(job, combined);
    if (this.current(activation)) this.arm(activation, job);
    this.pi.events.emit('subagents:scheduled', { type: 'added', job }); return job;
  }
  async remove(id: string): Promise<void> {
    const activation = this.activation;
    if (!activation || !this.current(activation)) throw new ToolError('STALE_BINDING', 'Scheduler is not active');
    await activation.store.remove(id, activation.controller.signal); this.unschedule(id);
    this.pi.events.emit('subagents:scheduled', { type: 'removed', jobId: id });
  }
  private unschedule(id: string): void {
    this.crons.get(id)?.stop(); this.crons.delete(id);
    clearTimeout(this.timers.get(id)); this.timers.delete(id);
  }
  private arm(activation: Activation, job: ScheduledAgent): void {
    if (!this.current(activation) || !job.enabled) return;
    if (job.scheduleType === 'cron') {
      if (!this.crons.has(job.id)) this.crons.set(job.id, new Cron(job.schedule, { unref: true }, () => {
        const next = activation.store.current.jobs.find(item => item.id === job.id)?.nextRun;
        if (next) this.dispatch(activation, job.id, next);
      }));
      return;
    }
    this.unschedule(job.id);
    // Node converts delays above 2^31-1 to 1ms. Re-arm toward the same absolute deadline
    // so long one-shots/intervals retain their requested time without a hot loop.
    const delay = Math.max(1, Math.min(2_147_483_647, Date.parse(job.nextRun!) - Date.now()));
    this.timers.set(job.id, setTimeout(() => {
      this.timers.delete(job.id);
      if (Date.now() < Date.parse(job.nextRun!)) this.arm(activation, job);
      else this.dispatch(activation, job.id, job.nextRun!);
    }, delay).unref());
  }
  private error(activation: Activation, id: string, occurrence: string, error: string): void {
    this.pi.events.emit('subagents:scheduled', { type: 'error', jobId: id, error });
    this.notices.enqueue(activation.binding.sessionId, `schedule:${id}:${occurrence}`, `Schedule ${id} failed: ${error}\nManage: /agents schedules`);
  }
  private dispatch(activation: Activation, id: string, deadline: string): void {
    const work = this.fire(activation, id, deadline).catch(error => this.error(activation, id, deadline, String(error)))
      .finally(() => { this.pending.delete(work); });
    this.pending.add(work);
  }
  private async fire(activation: Activation, id: string, deadline: string): Promise<void> {
    if (!this.current(activation)) return;
    let occurrence: string | undefined;
    try {
      const now = Date.now(), job = await activation.store.claim(id, deadline, now, activation.controller.signal);
      if (!job) { this.unschedule(id); return; }
      occurrence = new Date(now).toISOString();
      const updated = activation.store.current.jobs.find(item => item.id === id)!;
      this.arm(activation, updated);
      const run = await this.agents.manager.start(job.request, this.agents.scope(activation.binding.ctx), this.config(), undefined,
        { scheduleId: id, bypassQueue: true, signal: activation.controller.signal });
      await activation.store.setRun(id, occurrence, run.record.id, run.record.runId);
      this.pi.events.emit('subagents:scheduled', { type: 'fired', jobId: id, agentId: run.record.id, name: job.name });
      const result = await run.done.promise, success = result.state === 'completed';
      await activation.store.finish(id, occurrence, success, result.error ?? (success ? undefined : result.state));
    } catch (error) {
      // File/dispatch failures are visible. An aborted, uncommitted claim is simply cancelled.
      if (occurrence) await activation.store.finish(id, occurrence, false, String(error));
      if (!activation.controller.signal.aborted) this.error(activation, id, deadline, String(error));
    }
  }
}
