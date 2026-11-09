import type { Theme } from '@earendil-works/pi-coding-agent';
import type { DerivedChange, EditReceipt, EditResult, TaskView } from './types.ts';
import { taskTitle } from './query.ts';
import { sanitizeText } from '../runtime/text.ts';

export const taskIcon = (state: string): string => ({ doing: '⟳', blocked: '⚠', done: '☑' })[state] ?? '☐';
// Reuse the Dock heading's accent for pending work across every task view.
export const taskTone = (state: TaskView['status']) => ({ todo: 'accent', doing: 'success', blocked: 'warning', done: 'dim' } as const)[state];
export const taskHeading = (task: Pick<TaskView, 'id' | 'title' | 'status'>) => `${task.id} ${taskTitle(task)}${task.status === 'blocked' ? ' (Blocked)' : ''}`;
export function taskRow(task: Pick<TaskView, 'id' | 'title' | 'parentId' | 'status'>, theme?: Theme): string {
  const text = `${taskIcon(task.status)} ${taskHeading(task)}`;
  return taskStyle(task, text, theme);
}
/** Apply trusted theme styling after readers have sanitized/truncated task data. */
export function taskStyle(task: Pick<TaskView, 'status'>, text: string, theme?: Theme): string {
  if (!theme) return text;
  return theme.fg(taskTone(task.status),
    task.status === 'done' ? `\x1b[9m${text}\x1b[29m` : text);
}
export function receiptLine(change: EditReceipt): string {
  const title = sanitizeText(change.title).replace(/[\r\n\t]/g, ' ');
  if (change.op === 'add' || change.op === 'delete') return `${change.op} ${change.id} ${title}${change.parentId ? ` · group ${change.parentId}` : ''}`;
  if (!Object.keys(change.fields ?? {}).length) return `unchanged ${change.id} ${title}`;
  const fields = Object.entries(change.fields ?? {}).filter(([key, value]) => key !== 'title' && key !== 'blockedReason' && !(key === 'status' && value === change.after))
    .map(([key, value]) => key === 'description' ? `description ${String(value).length} chars` : `${key}=${JSON.stringify(value)}`);
  return `${change.before !== change.after ? change.after : change.op} ${change.id} ${title}${fields.length ? ` · ${fields.join(', ')}` : ''}${change.fields?.blockedReason ? ` · ${change.fields.blockedReason}` : ''}`;
}
export function editLines(result: EditResult): string[] {
  return [...result.changes.map(receiptLine), ...result.derived.map(change => `${change.status} ${change.id} ${sanitizeText(change.title).replace(/\s+/g, ' ')} · group ${change.parentId} · dependencies ${change.before}→${change.status}`),
    ...result.progress.map(group => `${group.id} ${group.done}/${group.total} ${group.status}`),
    ...result.warnings.map(warning => `warning: ${warning}`)];
}
export const derivedDisplay = (change: DerivedChange): string => `${taskIcon(change.status)} ${change.id} ${sanitizeText(change.title).replace(/\s+/g, ' ')} · ${change.status === 'blocked' ? 'blocked' : 'dependencies cleared'}`;
export function receiptAction(change: EditReceipt): string {
  return change.op === 'add' ? 'created' : change.op === 'delete' ? 'deleted' : !Object.keys(change.fields ?? {}).length ? 'unchanged'
    : change.before !== change.after ? ({ doing: 'started', done: 'completed', blocked: 'blocked', todo: 'pending' })[change.after!] : 'updated';
}
export function receiptDisplay(change: EditReceipt): string {
  return `${taskIcon(change.after ?? change.before ?? '')} ${change.id} ${sanitizeText(change.title).replace(/[\r\n\t]/g, ' ')} · ${receiptAction(change)}${change.fields?.blockedReason ? `: ${sanitizeText(String(change.fields.blockedReason))}` : ''}`;
}
