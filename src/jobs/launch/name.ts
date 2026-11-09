import { sanitizeText } from '../../runtime/text.ts';
import type { MonitorInput } from '../monitors/compile.ts';

const literal = (text: string) => sanitizeText(text).replace(/[\r\n\t]/g, ' ').trim();
/** Derive from the caller's command, not the generated polling/watch transport program. */
export function jobName(source: { name?: string; command?: string; monitor?: MonitorInput }): string {
  const name = literal(source.name ?? '');
  if (name) return name;
  if (source.monitor?.fileWatch) {
    const path = literal(source.monitor.fileWatch.path);
    return path ? `watch ${path}` : 'File monitor (path unavailable)';
  }
  const command = source.command?.split(/\r?\n/).map(literal).find(Boolean);
  // Saved history can lack a usable command. Say what is missing rather than naming it with an ID.
  return command || (source.monitor ? `${source.monitor.strategy ?? 'stream'} monitor (command unavailable)` : 'Command unavailable');
}
