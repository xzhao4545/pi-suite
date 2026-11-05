import { ToolError } from '../runtime/errors.ts';
import { sanitizeText } from '../runtime/text.ts';
import { taskViews } from './model.ts';
import type { TaskData, TaskView } from './types.ts';

export type TaskQuery = { id?: string; parentId?: string; includeDone?: boolean; detail?: boolean };
export function queryTasks(data: TaskData, query: TaskQuery): TaskView[] {
  if (query.id !== undefined && query.parentId !== undefined) throw new ToolError('INVALID_ARGS', 'id and parentId are exclusive');
  const views = taskViews(data);
  const find = (id: string) => { const task = views.find(task => task.id === id); if (!task) throw new ToolError('NOT_FOUND', `No task #${id}`); return task; };
  if (query.id) return [find(query.id)];
  const groups = query.parentId ? [find(query.parentId)] : views.filter(task => !task.parentId && (query.includeDone || task.status !== 'done'));
  if (groups.some(task => task.parentId)) throw new ToolError('INVALID_ARGS', 'parentId must identify a group');
  const children = new Map(groups.map(group => [group.id, [] as TaskView[]]));
  for (const task of views) if (task.parentId && (query.includeDone || task.status !== 'done')) children.get(task.parentId)?.push(task);
  return groups.flatMap(group => [group, ...children.get(group.id)!]);
}
/** Terminal text is data: preserve one summary line even when titles contain control bytes. */
export function taskLabel(task: TaskView): string {
  return `#${task.id} ${taskTitle(task)} · ${task.progress ? `${task.progress.done}/${task.progress.total} · ` : ''}${task.status}`;
}
export const taskTitle = (task: TaskView) => sanitizeText(task.title).replace(/[\r\n\t]/g, ' ').trim();
export const openBlockers = (task: TaskView, views: Map<string, TaskView>) => task.blockedBy.filter(id => views.get(id)?.status !== 'done');
export function taskDetails(task: TaskView, views: Map<string, TaskView>): string[] {
  const open = openBlockers(task, views);
  return [taskLabel(task), ...task.parentId ? [`parent #${task.parentId}`] : [],
    ...task.description ? [task.description] : [], ...open.length ? [`blockedBy: ${open.map(id => `#${id}`).join(', ')}`] : [],
    ...task.blocks.length ? [`blocks: ${task.blocks.map(id => `#${id}`).join(', ')}`] : [],
    ...task.owner ? [`agent: ${task.owner}`] : [], ...task.jobIds.length ? [`jobs: ${task.jobIds.join(', ')}`] : []];
}
