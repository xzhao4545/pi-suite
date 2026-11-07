import { ToolError } from '../runtime/errors.ts';
import { sanitizeText } from '../runtime/text.ts';
import { taskViews } from './model.ts';
import type { TaskData, TaskView } from './types.ts';

export type TaskFilter = 'unfinished' | 'doing' | 'blocked' | 'done' | 'all';
export type TaskQuery = { id?: string; parentId?: string; includeDone?: boolean; detail?: boolean; state?: TaskFilter };
export function queryTasks(data: TaskData, query: TaskQuery): TaskView[] {
  if (query.id !== undefined && query.parentId !== undefined) throw new ToolError('INVALID_ARGS', 'id and parentId are exclusive');
  const views = taskViews(data);
  const find = (id: string) => { const task = views.find(task => task.id === id); if (!task) throw new ToolError('NOT_FOUND', `No task ${id}; discover with task_list({"state":"all"})`); return task; };
  if (query.id) return [find(query.id)];
  const includeDone = query.includeDone || query.state === 'all' || query.state === 'done';
  const match = (task: TaskView) => !query.state || query.state === 'unfinished' ? task.status !== 'done' || includeDone
    : query.state === 'all' || task.status === query.state;
  const groups = query.parentId ? [find(query.parentId)] : views.filter(task => !task.parentId && (includeDone || task.status !== 'done'));
  if (groups.some(task => task.parentId)) throw new ToolError('INVALID_ARGS', 'parentId must identify a group');
  const children = new Map(groups.map(group => [group.id, [] as TaskView[]]));
  for (const task of views) if (task.parentId && match(task)) children.get(task.parentId)?.push(task);
  return groups.flatMap(group => match(group) || children.get(group.id)!.length || query.parentId ? [group, ...children.get(group.id)!] : []);
}
/** Terminal text is data: preserve one summary line even when titles contain control bytes. */
export function taskLabel(task: TaskView): string {
  return `${task.id} ${taskTitle(task)} · ${task.progress ? `${task.progress.done}/${task.progress.total} · ` : ''}${task.status}`;
}
export const taskTitle = (task: Pick<TaskView, 'title'>) => sanitizeText(task.title).replace(/[\r\n\t]/g, ' ').trim();
export const openBlockers = (task: TaskView, views: Map<string, TaskView>) => task.blockedBy.filter(id => views.get(id)?.status !== 'done');
export function taskDetails(task: TaskView, views: Map<string, TaskView>): string[] {
  const open = openBlockers(task, views);
  return [taskLabel(task), ...task.parentId ? [`parent ${task.parentId}`] : [],
    ...task.description ? [task.description] : [], ...task.blockedReason ? [`blocked: ${task.blockedReason}`] : [], ...open.length ? [`blockedBy: ${open.map(id => `${id}`).join(', ')}`] : [],
    ...task.blocks.length ? [`blocks: ${task.blocks.map(id => `${id}`).join(', ')}`] : [],
    ...task.owner ? [`agent: ${task.owner}`] : [], ...task.jobIds.length ? [`jobs: ${task.jobIds.join(', ')}`] : []];
}
