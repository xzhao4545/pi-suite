// CRUD/dependency rules adapted from @tintinweb/pi-tasks 0.9.1 src/task-store.ts (MIT).
// pi-suite changes: two levels, derived group progress, canonical dependency edges, atomic batches.
import { ToolError } from '../runtime/errors.ts';
import type { EditReceipt, EditResult, Task, TaskChange, TaskData, TaskView } from './types.ts';

/** One pass builds direct-child counts and reverse edges; consumers never maintain counters. */
export function taskViews(data: TaskData): TaskView[] {
  const groups = new Map(data.tasks.filter(task => !task.parentId).map(task => [task.id, { done: 0, total: 0, doing: 0 }]));
  const reverse = new Map<string, string[]>();
  for (const task of data.tasks) {
    if (task.parentId) {
      const group = groups.get(task.parentId)!;
      group.total++; group.done += Number(task.status === 'done'); group.doing += Number(task.status === 'doing');
    }
    for (const blocker of task.blockedBy) { const edges = reverse.get(blocker) ?? []; edges.push(task.id); reverse.set(blocker, edges); }
  }
  return data.tasks.map(task => {
    const count = groups.get(task.id);
    return { ...task, blocks: reverse.get(task.id) ?? [], status: count
      ? count.total > 0 && count.done === count.total ? 'done' : count.doing > 0 ? 'doing' : 'todo' : task.status!,
      ...(count ? { progress: { done: count.done, total: count.total } } : {}) };
  });
}

/** Relational storage invariants are checked once at the file boundary, before replacing data. */
export function validateHierarchy(data: TaskData): void {
  const tasks = new Map(data.tasks.map(task => [task.id, task]));
  if (tasks.size !== data.tasks.length || data.tasks.some(task => Number(task.id) >= data.nextId || !Number.isSafeInteger(Number(task.id)))) {
    throw new Error('Duplicate task IDs or invalid nextId');
  }
  for (const task of data.tasks) {
    if (!task.title.trim() || (task.parentId ? !task.status || !tasks.has(task.parentId) || tasks.get(task.parentId)!.parentId : task.status !== undefined)) {
      throw new Error(`Invalid two-level task structure at #${task.id}`);
    }
  }
}

export function applyChanges(data: TaskData, changes: TaskChange[]): EditResult {
  const receipts: EditReceipt[] = [], warnings: string[] = [], affected = new Set<string>();
  const find = (id: string) => { const task = data.tasks.find(task => task.id === id); if (!task) throw new Error(`No task #${id}`); return task; };
  const group = (id: string) => { const task = find(id); if (task.parentId) throw new Error(`#${id} is a child, not a group`); return task; };
  const create = (title: string, description?: string, parentId?: string): Task => {
    if (!title.trim()) throw new Error('title must contain text');
    const task: Task = { id: String(data.nextId++), title: title.trim(), ...(description ? { description } : {}),
      ...(parentId ? { parentId, status: 'todo' } : {}), blockedBy: [], jobIds: [], createdAt: Date.now(), updatedAt: Date.now() };
    data.tasks.push(task); affected.add(parentId ?? task.id);
    receipts.push({ op: 'add', id: task.id, ...(parentId ? { parentId } : {}), fields: { title: task.title } }); return task;
  };
  changes.forEach((change, index) => {
    try {
      if (change.op === 'delete') {
        const task = find(change.id), children = data.tasks.filter(item => item.parentId === task.id);
        if (children.length && !change.cascade) throw new Error('Deleting a group with children requires cascade:true');
        const ids = new Set([task.id, ...children.map(item => item.id)]);
        data.tasks = data.tasks.filter(item => !ids.has(item.id));
        for (const item of data.tasks) item.blockedBy = item.blockedBy.filter(id => !ids.has(id));
        for (const id of ids) receipts.push({ op: 'delete', id });
        if (task.parentId) affected.add(task.parentId);
        return;
      }
      let task: Task;
      if (change.op === 'add') {
        if (change.parentId) group(change.parentId);
        if (!change.parentId && change.status !== undefined) throw new Error('Group status is derived from its children');
        if (change.parentId && change.children !== undefined) throw new Error('Children cannot contain children');
        task = create(change.title, change.description, change.parentId);
        for (const title of change.children ?? []) create(title, undefined, task.id);
      } else {
        task = find(change.id); affected.add(task.parentId ?? task.id);
        if (change.parentId) {
          if (!task.parentId) throw new Error('Only children can move between groups');
          group(change.parentId);
        }
        if (change.status !== undefined && !task.parentId) throw new Error('Group status is derived from its children');
        if (change.title !== undefined && !change.title.trim()) throw new Error('title must contain text');
      }
      const fields: Record<string, unknown> = {};
      for (const key of ['title', 'description', 'parentId', 'status', 'blockedBy'] as const) {
        const value = key === 'title' ? change.title?.trim() : change[key];
        if (value === undefined || JSON.stringify(value) === JSON.stringify(task[key])) continue;
        if (key === 'description' && value === '') delete task.description;
        else Object.assign(task, { [key]: value });
        fields[key] = value;
      }
      task.updatedAt = Date.now(); affected.add(task.parentId ?? task.id);
      if (change.op === 'update') receipts.push({ op: 'update', id: task.id, fields });
      else Object.assign(receipts.find(item => item.id === task.id)!.fields!, fields);
      for (const id of change.blockedBy ?? []) {
        const blocker = data.tasks.find(item => item.id === id);
        if (id === task.id) warnings.push(`changes[${index}]: #${task.id} blocks itself`);
        else if (!blocker) warnings.push(`changes[${index}]: #${id} does not exist`);
        else if (blocker.blockedBy.includes(task.id)) warnings.push(`changes[${index}]: #${task.id} and #${id} block each other`);
      }
      if (change.status === 'doing' || change.status === 'done') {
        const views = taskViews(data), open = task.blockedBy.filter(id => views.find(item => item.id === id)?.status !== 'done');
        if (open.length) warnings.push(`changes[${index}]: #${task.id} set to ${change.status} with open blockers: ${open.map(id => `#${id}`).join(', ')}`);
      }
    } catch (error) { throw new ToolError('INVALID_ARGS', `changes[${index}]: ${error instanceof Error ? error.message : String(error)}`); }
  });
  const progress = taskViews(data).filter(task => affected.has(task.id) && task.progress)
    .map(task => ({ id: task.id, status: task.status, ...task.progress! }));
  return { changes: receipts, progress, warnings };
}
