import { ToolError } from '../runtime/errors.ts';
import { sanitizeText } from '../runtime/text.ts';
import { field, part, plainDetailLines, statePart, type StructuredDetails } from '../ui/structured-details.ts';
import { taskViews } from './model.ts';
import type { TaskData, TaskView } from './types.ts';

export type TaskFilter = 'unfinished' | 'doing' | 'blocked' | 'done' | 'all';
export type TaskQuery = { id?: string; parentId?: string; includeDone?: boolean; detail?: boolean; state?: TaskFilter };
export function queryTasks(data: TaskData, query: TaskQuery): TaskView[] {
  if (query.id !== undefined && query.parentId !== undefined) throw new ToolError('INVALID_ARGS', 'id and parentId cannot be combined. Use id for one task or parentId for a group list.');
  const views = taskViews(data);
  const find = (id: string) => { const task = views.find(task => task.id === id); if (!task) throw new ToolError('NOT_FOUND', `No task ${id}; discover with task_list({"state":"all"})`); return task; };
  if (query.id) return [find(query.id)];
  const includeDone = query.includeDone || query.state === 'all' || query.state === 'done';
  const match = (task: TaskView) => !query.state || query.state === 'unfinished' ? task.status !== 'done' || includeDone
    : query.state === 'all' || task.status === query.state;
  const groups = query.parentId ? [find(query.parentId)] : views.filter(task => !task.parentId && (includeDone || task.status !== 'done'));
  if (groups.some(task => task.parentId)) throw new ToolError('INVALID_ARGS', 'A group filter cannot use a child ID. Use its group ID, for example 1 instead of 1.2.');
  const children = new Map(groups.map(group => [group.id, [] as TaskView[]]));
  for (const task of views) if (task.parentId && match(task)) children.get(task.parentId)?.push(task);
  return groups.flatMap(group => match(group) || children.get(group.id)!.length || query.parentId ? [group, ...children.get(group.id)!] : []);
}
const taskHeading = (task: TaskView) => [part(task.id, 'id'), part(' '), part(taskTitle(task), 'heading'), part(' · '),
  ...(task.progress ? [part(`${task.progress.done}/${task.progress.total}`, 'number'), part(' · ')] : []), statePart(task.status)];
/** Terminal text is data: preserve one summary line even when titles contain control bytes. */
export const taskLabel = (task: TaskView): string => taskHeading(task).map(({text}) => text).join('');
export const taskTitle = (task: Pick<TaskView, 'title'>) => sanitizeText(task.title).replace(/[\r\n\t]/g, ' ').trim();
export const openBlockers = (task: TaskView, views: Map<string, TaskView>) => task.blockedBy.filter(id => views.get(id)?.status !== 'done');
export function taskDetailsView(task: TaskView, views: Map<string, TaskView>): StructuredDetails {
  const open = openBlockers(task, views);
  return {rows: [taskHeading(task), task.parentId ? field('parent', part(task.parentId, 'id')) : undefined, null,
    task.description || undefined, task.blockedReason ? field('blocked:', part(task.blockedReason, 'error')) : undefined, null,
    open.length ? field('blockedBy:', part(open.join(', '), 'id')) : undefined,
    task.blocks.length ? field('blocks:', part(task.blocks.join(', '), 'id')) : undefined,
    task.owner ? field('agent:', part(task.owner, 'id')) : undefined,
    task.jobIds.length ? field('jobs:', part(task.jobIds.join(', '), 'id')) : undefined]};
}
export const taskDetails = (task: TaskView, views: Map<string, TaskView>): string[] => plainDetailLines(taskDetailsView(task, views));
