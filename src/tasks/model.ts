// CRUD/dependency rules adapted from @tintinweb/pi-tasks 0.9.1 src/task-store.ts (MIT).
// pi-suite changes: two levels, derived group progress, canonical dependency edges, atomic batches.
import { ToolError } from '../runtime/errors.ts';
import type { EditReceipt, EditResult, Task, TaskChange, TaskData, TaskView } from './types.ts';
import type { Static } from 'typebox';
import { mutationSchema } from './types.ts';

/** One pass builds direct-child counts and reverse edges; consumers never maintain counters. */
export function taskViews(data: TaskData): TaskView[] {
  const groups = new Map(data.tasks.filter(task => !task.parentId).map(task => [task.id, { done: 0, total: 0, doing: 0, blocked: 0 }]));
  const reverse = new Map<string, string[]>();
  for (const task of data.tasks) {
    if (task.parentId) {
      const group = groups.get(task.parentId)!;
      group.total++; group.done += Number(task.status === 'done');
    }
    for (const blocker of task.blockedBy) { const edges = reverse.get(blocker) ?? []; edges.push(task.id); reverse.set(blocker, edges); }
  }
  // Completion is independent of blocking, so dependency cycles never require recursive views.
  const done = new Set(data.tasks.filter(task => task.status === 'done').map(task => task.id));
  for (const [id, count] of groups) if (count.total && count.done === count.total) done.add(id);
  const views = data.tasks.map(task => {
    const count = groups.get(task.id);
    const status = done.has(task.id) ? 'done' : task.blockedBy.some(id => !done.has(id)) ? 'blocked' : task.status ?? 'todo';
    if (task.parentId) {
      const parent = groups.get(task.parentId)!;
      parent.doing += Number(status === 'doing'); parent.blocked += Number(status === 'blocked');
    }
    return { ...task, blocks: reverse.get(task.id) ?? [], status,
      ...(count ? { progress: { done: count.done, total: count.total } } : {}) };
  });
  return views.map(task => {
    const count = groups.get(task.id);
    return { ...task, status: !count || task.status === 'done' || task.status === 'blocked' ? task.status
      : count.doing ? 'doing' : count.total > count.done && count.blocked === count.total - count.done ? 'blocked' : 'todo' };
  });
}

/** Pick actual execution work, independent of the group's derived status. */
export function currentChild(group: TaskView, views: TaskView[]): TaskView | undefined {
  const children = views.filter(task => task.parentId === group.id);
  return children.reduce<TaskView | undefined>((latest, task) => task.status === 'doing' && (!latest || task.updatedAt > latest.updatedAt) ? task : latest, undefined)
    ?? children.find(task => task.status === 'blocked') ?? children.find(task => task.status === 'todo');
}

/** Relational storage invariants are checked once at the file boundary, before replacing data. */
export function validateHierarchy(data: TaskData): void {
  if (!Number.isSafeInteger(data.nextId) || data.nextId < 1) throw new Error('Invalid nextId');
  const tasks = new Map(data.tasks.map(task => [task.id, task]));
  if (tasks.size !== data.tasks.length) throw new Error('Duplicate task IDs');
  for (const task of data.tasks) {
    const parent = task.parentId ? tasks.get(task.parentId) : undefined;
    const [prefix, ordinal] = task.id.split('.');
    const valid = task.parentId
      ? /^[1-9][0-9]*\.[1-9][0-9]*$/.test(task.id) && prefix === task.parentId && !!task.status
        && task.nextChild === undefined && parent && !parent.parentId && parent.nextChild !== undefined
        && Number.isSafeInteger(Number(ordinal)) && Number(ordinal) < parent.nextChild
      : /^[1-9][0-9]*$/.test(task.id) && Number.isSafeInteger(Number(task.id)) && Number(task.id) < data.nextId
        && task.nextChild !== undefined && Number.isSafeInteger(task.nextChild) && task.nextChild >= 1 && task.status === undefined;
    if (!valid || !task.title.trim() || task.blockedReason !== undefined && task.status !== 'blocked') {
      throw new Error(`Invalid two-level task structure at ${task.id}`);
    }
  }
}

export function applyChanges(data: TaskData, changes: TaskChange[]): EditResult {
  const receipts: EditReceipt[] = [], warnings: string[] = [], affected = new Set<string>();
  const previous = new Map(taskViews(data).map(task => [task.id, task.status]));
  const find = (id: string) => { const task = data.tasks.find(task => task.id === id); if (!task) throw new Error(`No task ${id}`); return task; };
  const group = (id: string) => { const task = find(id); if (task.parentId) throw new Error(`${id} is a child, not a group`); return task; };
  const create = (title: string, description?: string, parentId?: string): Task => {
    if (!title.trim()) throw new Error('title must contain text');
    const parent = parentId ? group(parentId) : undefined;
    const id = parent ? `${parent.id}.${parent.nextChild!++}` : String(data.nextId++);
    const task: Task = { id, title: title.trim(), ...(description ? { description } : {}),
      ...(parentId ? { parentId, status: 'todo' } : { nextChild: 1 }), blockedBy: [], jobIds: [], createdAt: Date.now(), updatedAt: Date.now() };
    data.tasks.push(task); affected.add(parentId ?? task.id);
    receipts.push({ op: 'add', id: task.id, title: task.title, ...(parentId ? { parentId } : {}), fields: { title: task.title } }); return task;
  };
  changes.forEach((input, index) => {
    try {
      let change: Static<typeof mutationSchema>;
      if (input.op === 'add' || input.op === 'update' || input.op === 'delete') change = input;
      else {
        const task = find(input.id);
        if (!task.parentId) throw new Error('Execution operations need a child ID; group progress is derived');
        const status = input.op === 'start' ? 'doing' : input.op === 'done' ? 'done' : input.op === 'block'
          ? task.status === 'done' ? 'done' : 'blocked' : task.status === 'blocked' ? 'todo' : task.status;
        change = { op: 'update', id: task.id, status,
          ...input.op === 'block' && status !== 'done' ? { blockedReason: input.reason?.replace(/\s+/g, ' ').trim() ?? '' } : {} };
      }
      if (change.op === 'delete') {
        const task = find(change.id), children = data.tasks.filter(item => item.parentId === task.id);
        if (children.length && !change.cascade) throw new Error('Deleting a group with children requires cascade:true');
        const ids = new Set([task.id, ...children.map(item => item.id)]);
        data.tasks = data.tasks.filter(item => !ids.has(item.id));
        for (const item of data.tasks) item.blockedBy = item.blockedBy.filter(id => !ids.has(id));
        for (const item of [task, ...children]) receipts.push({ op: 'delete', id: item.id, title: item.title, parentId: item.parentId, before: previous.get(item.id) });
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
        if (change.status !== undefined && !task.parentId) throw new Error('Group status is derived from its children');
        if (change.blockedReason !== undefined && (change.status ?? task.status) !== 'blocked') throw new Error('blockedReason requires a blocked child');
        if (change.title !== undefined && !change.title.trim()) throw new Error('title must contain text');
      }
      const fields: Record<string, unknown> = {};
      for (const key of ['title', 'description', 'status', 'blockedBy', 'blockedReason'] as const) {
        if (key === 'blockedReason' && change.op === 'add') continue;
        const value = key === 'title' ? change.title?.trim() : key === 'blockedReason' ? change.op === 'update' ? change.blockedReason : undefined : change[key];
        if (value === undefined || JSON.stringify(value) === JSON.stringify(task[key])) continue;
        if ((key === 'description' || key === 'blockedReason') && value === '') delete task[key];
        else Object.assign(task, { [key]: value });
        fields[key] = value;
      }
      if (task.status !== 'blocked' && task.blockedReason !== undefined) { delete task.blockedReason; fields.blockedReason = ''; }
      task.updatedAt = Date.now(); affected.add(task.parentId ?? task.id);
      if (change.op === 'update') receipts.push({ op: input.op, id: task.id, title: task.title, parentId: task.parentId, fields, before: previous.get(task.id) });
      else Object.assign(receipts.find(item => item.id === task.id)!.fields!, fields);
      for (const id of change.blockedBy ?? []) {
        const blocker = data.tasks.find(item => item.id === id);
        if (id === task.id) warnings.push(`changes[${index}]: ${task.id} blocks itself`);
        else if (!blocker) warnings.push(`changes[${index}]: ${id} does not exist`);
        else if (blocker.blockedBy.includes(task.id)) warnings.push(`changes[${index}]: ${task.id} and ${id} block each other`);
      }
      if (change.status === 'doing' || change.status === 'done') {
        const views = taskViews(data), open = task.blockedBy.filter(id => views.find(item => item.id === id)?.status !== 'done');
        if (open.length) warnings.push(`changes[${index}]: ${task.id} set to ${change.status} with open blockers: ${open.map(id => `${id}`).join(', ')}`);
      }
    } catch (error) { throw new ToolError('INVALID_ARGS', `changes[${index}]: ${error instanceof Error ? error.message : String(error)}; no changes committed`); }
  });
  const views = taskViews(data), statuses = new Map(views.map(task => [task.id, task.status]));
  for (const receipt of receipts) receipt.after = statuses.get(receipt.id);
  const changedIds = new Set(receipts.map(receipt => receipt.id));
  // Completing/deleting a blocker can change another group's effective state
  // without writing that task. Report those facts from the canonical views too.
  const derived = views.filter(task => task.parentId && previous.has(task.id) && previous.get(task.id) !== task.status && !changedIds.has(task.id))
    .map(task => ({ id: task.id, title: task.title, parentId: task.parentId!, before: previous.get(task.id)!, status: task.status }));
  for (const change of derived) affected.add(change.parentId);
  for (const task of views) if (task.progress && previous.has(task.id) && previous.get(task.id) !== task.status) affected.add(task.id);
  const progress = views.filter(task => affected.has(task.id) && task.progress)
    .map(task => ({ id: task.id, status: task.status, ...task.progress! }));
  return { changes: receipts, derived, progress, warnings };
}
