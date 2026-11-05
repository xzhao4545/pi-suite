// Session scope and reload-under-lock adapted from @tintinweb/pi-subagents 0.23.0
// src/schedule-store.ts (MIT). Tasks and schedules share the same JSON file protocol.
import { join } from 'node:path';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { JsonStore } from '../../runtime/json-store.ts';
import { ToolError } from '../../runtime/errors.ts';
import { thinkingSchema } from '../catalog.ts';
import { parseSchedule, nextOccurrence } from './parse.ts';

const iso = Type.String({ format: 'date-time' });
export const scheduleSchema = Type.Object({
  id: Type.String({ pattern: '^schedule_[a-f0-9]{8}$' }), name: Type.String({ minLength: 1, maxLength: 80 }),
  schedule: Type.String({ minLength: 1 }), scheduleType: Type.Union([Type.Literal('once'), Type.Literal('cron'), Type.Literal('interval')]),
  intervalMs: Type.Optional(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
  request: Type.Object({ prompt: Type.String({ minLength: 1 }), type: Type.String({ minLength: 1 }), name: Type.Optional(Type.String({ maxLength: 80 })),
    model: Type.Optional(Type.String({ minLength: 1 })), thinking: Type.Optional(thinkingSchema),
    maxTurns: Type.Optional(Type.Integer({ minimum: 0 })), isolated: Type.Optional(Type.Boolean()), taskId: Type.Optional(Type.String({ pattern: '^[1-9][0-9]*$' })) }, { additionalProperties: false }),
  enabled: Type.Boolean(), createdAt: iso, nextRun: Type.Optional(iso), runCount: Type.Integer({ minimum: 0 }),
  lastRun: Type.Optional(iso), lastStatus: Type.Optional(Type.Union([Type.Literal('running'), Type.Literal('success'), Type.Literal('error')])),
  lastError: Type.Optional(Type.String()), lastAgentId: Type.Optional(Type.String()), lastRunId: Type.Optional(Type.String()),
}, { additionalProperties: false });
const dataSchema = Type.Object({ version: Type.Literal(1), jobs: Type.Array(scheduleSchema) }, { additionalProperties: false });
export type ScheduledAgent = Static<typeof scheduleSchema>;
type ScheduleData = Static<typeof dataSchema>;
export function schedulePath(agentDir: string, sessionId: string): string {
  return join(agentDir, 'pi-suite', 'agents', 'schedules', `${sessionId}.json`);
}
export class ScheduleStore extends JsonStore<ScheduleData> {
  constructor(path: string) {
    super(path, { version: 1, jobs: [] }, value => {
      if (!Value.Check(dataSchema, value)) throw new Error('Invalid schedule version or data');
      if (new Set(value.jobs.map(job => job.id)).size !== value.jobs.length || new Set(value.jobs.map(job => job.name)).size !== value.jobs.length) throw new Error('Duplicate schedule identities');
      for (const job of value.jobs) {
        const spec = parseSchedule(job.schedule, Date.now(), true);
        if (spec.scheduleType !== job.scheduleType || spec.intervalMs !== job.intervalMs || job.enabled && !job.nextRun) throw new Error(`Inconsistent schedule: ${job.id}`);
      }
      return value;
    }, 'SCHEDULE');
  }
  add(job: ScheduledAgent, signal?: AbortSignal): Promise<void> {
    return this.mutate(data => {
      if (data.jobs.some(item => item.id === job.id || item.name === job.name)) throw new ToolError('INVALID_ARGS', `Schedule name already exists: ${job.name}`);
      data.jobs.push(job);
    }, signal);
  }
  update(id: string, patch: Partial<ScheduledAgent>, signal?: AbortSignal): Promise<void> {
    return this.mutate(data => { const job = data.jobs.find(item => item.id === id); if (job) Object.assign(job, patch); }, signal);
  }
  remove(id: string, signal?: AbortSignal): Promise<void> { return this.mutate(data => { data.jobs = data.jobs.filter(job => job.id !== id); }, signal); }
  setRun(id: string, occurrence: string, agentId: string, runId: string): Promise<void> {
    return this.mutate(data => {
      const job = data.jobs.find(item => item.id === id);
      if (job?.lastRun === occurrence) { job.lastAgentId = agentId; job.lastRunId = runId; }
    });
  }
  /** Commit the next occurrence before dispatch: two hosts observing one deadline cannot both launch it. */
  claim(id: string, expected: string, now: number, signal?: AbortSignal): Promise<ScheduledAgent | undefined> {
    return this.mutate(data => {
      const job = data.jobs.find(item => item.id === id);
      if (!job?.enabled || job.nextRun !== expected || Date.parse(expected) > now) return;
      const occurrence = structuredClone(job);
      job.nextRun = nextOccurrence(job, now, Date.parse(expected)); job.enabled = Boolean(job.nextRun);
      job.lastRun = new Date(now).toISOString(); job.lastStatus = 'running'; job.lastError = undefined;
      return occurrence;
    }, signal);
  }
  finish(id: string, occurrence: string, success: boolean, error?: string): Promise<void> {
    return this.mutate(data => {
      const job = data.jobs.find(item => item.id === id);
      if (!job) return;
      job.runCount++;
      // Intervals may overlap. An older completion cannot replace a newer run's status.
      if (job.lastRun === occurrence) { job.lastStatus = success ? 'success' : 'error'; job.lastError = error; }
    });
  }
}
