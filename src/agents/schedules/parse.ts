// Format detection/parsers adapted from @tintinweb/pi-subagents 0.23.0 src/schedule.ts (MIT).
import { Cron } from 'croner';
import { ToolError } from '../../runtime/errors.ts';

export type ScheduleSpec = { schedule: string; scheduleType: 'cron' | 'once' | 'interval'; intervalMs?: number };
const units = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
export function nextCron(schedule: string, after: number): string | undefined {
  // Parsing must not arm an otherwise invisible Cron callback, as the upstream check did.
  const cron = new Cron(schedule, { paused: true, unref: true });
  try { return cron.nextRun(new Date(after))?.toISOString(); } finally { cron.stop(); }
}
export function parseSchedule(input: string, now = Date.now(), allowPast = false): ScheduleSpec {
  const schedule = input.trim(), match = /^(\+?)(\d+)(s|m|h|d)$/.exec(schedule);
  if (match) {
    const intervalMs = Number(match[2]) * units[match[3] as keyof typeof units];
    if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0 || !Number.isFinite(new Date(now + intervalMs).getTime())) {
      throw new ToolError('INVALID_ARGS', 'Schedule duration must be a positive, representable number of seconds/minutes/hours/days');
    }
    return match[1] ? { scheduleType: 'once', schedule: new Date(now + intervalMs).toISOString() }
      : { scheduleType: 'interval', schedule, intervalMs };
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(schedule)) {
    const time = new Date(schedule).getTime();
    if (Number.isFinite(time)) {
      if (!allowPast && time <= now) throw new ToolError('INVALID_ARGS', `Scheduled time ${schedule} is in the past`);
      return { scheduleType: 'once', schedule: new Date(time).toISOString() };
    }
  }
  if (schedule.split(/\s+/).length === 6) {
    try {
      if (nextCron(schedule, now)) return { scheduleType: 'cron', schedule };
    } catch (error) { throw new ToolError('INVALID_ARGS', `Invalid cron schedule: ${String(error)}`); }
  }
  throw new ToolError('INVALID_ARGS', `Invalid schedule "${input}"; use six-field cron, an interval (5m/1h), or a one-shot (+10m/ISO timestamp)`);
}
export function nextOccurrence(spec: ScheduleSpec, after: number): string | undefined {
  if (spec.scheduleType === 'once') return;
  return spec.scheduleType === 'cron' ? nextCron(spec.schedule, after) : new Date(after + spec.intervalMs!).toISOString();
}
