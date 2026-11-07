import type { Theme } from '@earendil-works/pi-coding-agent';
import type { DerivedChange, EditReceipt, EditResult, TaskView } from './types.ts';
import { taskTitle } from './query.ts';
import { sanitizeText } from '../runtime/text.ts';

export const taskIcon = (state: string): string => ({ doing: '⟳', blocked: '⚠', done: '☑' })[state] ?? '☐';
export function taskRow(task: Pick<TaskView, 'id' | 'title' | 'parentId' | 'status'>, theme?: Theme): string {
  const text = `${task.parentId ? '  ' : ''}${taskIcon(task.status)} ${task.id} ${taskTitle(task)}`;
  return taskStyle(task, text, theme);
}
/** Apply trusted theme styling after readers have sanitized/truncated task data. */
export function taskStyle(task: Pick<TaskView, 'status'>, text: string, theme?: Theme): string {
  if (!theme || task.status === 'todo') return text;
  return theme.fg(task.status === 'doing' ? 'accent' : task.status === 'blocked' ? 'warning' : 'dim',
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
export const derivedDisplay = (change: DerivedChange): string => `${taskIcon(change.status)} ${change.id} ${sanitizeText(change.title).replace(/\s+/g, ' ')} · ${change.status === 'blocked' ? '已阻塞' : '依赖已解除'}`;
export function receiptAction(change: EditReceipt): string {
  return change.op === 'add' ? '已创建' : change.op === 'delete' ? '已删除' : !Object.keys(change.fields ?? {}).length ? '未变化'
    : change.before !== change.after ? ({ doing: '已开始', done: '已完成', blocked: '已阻塞', todo: '待处理' })[change.after!] : '已更新';
}
export function receiptDisplay(change: EditReceipt): string {
  return `${taskIcon(change.after ?? change.before ?? '')} ${change.id} ${sanitizeText(change.title).replace(/[\r\n\t]/g, ' ')} · ${receiptAction(change)}${change.fields?.blockedReason ? `：${sanitizeText(String(change.fields.blockedReason))}` : ''}`;
}
