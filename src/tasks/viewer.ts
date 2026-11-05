import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Text, type TUI } from '@earendil-works/pi-tui';
import { DetailsView } from '../ui/details.ts';
import type { Dock } from '../ui/dock.ts';
import type { Notifications } from '../runtime/notifications.ts';
import type { TasksModule } from './index.ts';
import { queryTasks, taskDetails } from './query.ts';
import { taskViews } from './model.ts';
import { sanitizeText } from '../runtime/text.ts';
import type { TaskData } from './types.ts';

/** The reader uses a snapshot; completion timers and child edits never move its selection. */
export class TaskDetailsView extends DetailsView {
  private expanded = true;
  private includeDone: boolean;
  constructor(tui: TUI, private data: TaskData, done: () => void, private parentId?: string, includeDone = false) {
    super(tui, () => `Tasks · ${this.includeDone ? 'all' : 'unfinished'} · ${this.expanded ? 'expanded' : 'collapsed'}`, new Text('', 0, 0), done, [
      { label: 'Expand / collapse', run: () => { this.expanded = !this.expanded; this.update(); } },
      { label: 'Show / hide completed', run: () => { this.includeDone = !this.includeDone; this.update(); } },
    ]);
    this.includeDone = includeDone; this.update();
  }
  private update(): void {
    const views = new Map(taskViews(this.data).map(task => [task.id, task])), rows = queryTasks(this.data, { parentId: this.parentId, includeDone: this.includeDone });
    const lines = rows.filter(task => this.expanded || !task.parentId).flatMap(task => [
      ...taskDetails(task, views).map(line => task.parentId ? `  ${line}` : line), '',
    ]);
    this.reader.setContent(new Text(sanitizeText(lines.join('\n')) || '(no tasks)', 0, 0));
  }
}

export function registerTasksCommand(pi: ExtensionAPI, tasks: TasksModule, dock: Dock, notifications: Notifications): void {
  pi.registerCommand('tasks', {
    description: 'Browse tasks: [all] [group ID]; expand/collapse and search without changing task data',
    handler: async (args, ctx) => {
      const words = args.trim().split(/\s+/).filter(Boolean);
      if (words.some(word => word !== 'all' && !/^[1-9][0-9]*$/.test(word)) || words.filter(word => word !== 'all').length > 1) throw new Error('Use /tasks [all] [group ID]');
      const parentId = words.find(word => word !== 'all'), includeDone = words.includes('all');
      const { data, rows } = await tasks.list(ctx, { parentId, includeDone });
      tasks.selectGroup(parentId);
      if (ctx.mode !== 'tui') {
        const views = new Map(taskViews(data).map(task => [task.id, task]));
        ctx.ui.notify(rows.map(task => taskDetails(task, views).join('\n')).join('\n\n') || 'No tasks'); return;
      }
      const release = notifications.hold(); dock.setDetail(true);
      try { await showTaskDetails(ctx, data, parentId, includeDone); }
      finally { dock.setDetail(false); release(); }
    },
  });
}
async function showTaskDetails(ctx: ExtensionContext, data: TaskData, parentId?: string, includeDone = false): Promise<void> {
  await ctx.ui.custom<void>((tui, _theme, _keys, done) => new TaskDetailsView(tui, data, done, parentId, includeDone));
}
