// Menu/control scope adapted from pi-subagents 0.23.0 ui/workflow-menu.ts and workflow-dialog.ts.
import { getAgentDir, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { SuiteConfig } from '../../../runtime/config.ts';
import type { Dock } from '../../../ui/dock.ts';
import { DetailsView, showDetails } from '../../../ui/details.ts';
import { openReading } from '../../../ui/reading.ts';
import { selectValue } from '../../../ui/select.ts';
import type { ScrollView } from '../../../ui/scroll.ts';
import { showJobLog } from '../../../jobs/log-viewer.ts';
import { resolveWorkspace } from '../../../jobs/workspace.ts';
import type { AgentsModule } from '../../index.ts';
import { showAgent, type AgentJobViewer } from '../../viewer.ts';
import type { OwnedWorkflowTask } from '../entry.ts';
import { workflowSummary, type WorkflowsModule } from '../index.ts';
import { workflowActive } from '../manager.ts';
import { collapse, displayState } from '../progress/index.ts';
import { listSavedWorkflows, readSavedWorkflow } from '../saved.ts';
import { WorkflowProgress } from './progress.ts';
import { browse, browseState, type BrowsePage, type BrowseState } from '../../../ui/browser.ts';

type Deps = {workflows: WorkflowsModule; agents: AgentsModule; dock: Dock; config: () => SuiteConfig; jobs?: AgentJobViewer};
const workflowControls = (task: OwnedWorkflowTask) => [
  {key: 'p' as const, label: 'Pause', available: () => workflowActive(task) && task.status !== 'paused'},
  {key: 'p' as const, label: 'Resume', available: () => task.status === 'paused'},
  {key: 'x' as const, label: 'Stop', confirm: true, available: () => workflowActive(task)},
  {key: 'r' as const, label: 'Replay journal', available: () => !workflowActive(task) && Boolean(task.journalPath)},
];
async function controlWorkflow(action: string, ctx: ExtensionContext, deps: Deps, task: OwnedWorkflowTask): Promise<void> {
  const manager = deps.workflows.manager;
  if (action === 'Pause') { if (await manager.pause(task.id)) ctx.ui.notify('Paused: running agents finish; new agents wait.'); }
  else if (action === 'Resume') await manager.resume(task.id);
  else if (action === 'Stop') await manager.stop(task.id);
  else if (action === 'Replay journal') {
    const replay = await manager.start({scriptPath: task.scriptPath, args: task.args, resumeFromRunId: task.id}, deps.agents.scope(ctx), deps.config());
    await showWorkflow(ctx, deps, replay);
  }
}
export async function showWorkflow(ctx: ExtensionContext, deps: Deps, task: OwnedWorkflowTask): Promise<void> {
  let reader: ScrollView | undefined, selectedAgent: string | undefined;
  const content = new WorkflowProgress(task);
  for (;;) {
    let action = '';
    deps.dock.setDetail(true);
    try {
      await openReading<void>(ctx, (tui, theme, _keys, done) => {
        // A workflow may settle while this detail remains open. Keep availability live,
        // so completion exposes replay and removes controls without a close/reopen cycle.
        const actions = [
          {key: 'enter' as const, label: 'Open children / gates'},
          ...workflowControls(task),
        ];
        const view = new DetailsView(tui, () => `Subagents ▸ Workflow · ${workflowSummary(task)}`, content, done,
          actions.map(item => ({...item, run: () => { action = item.label; done(); }})), reader, theme);
        view.reader.setContent(content, false); reader = view.reader;
        const off = deps.workflows.manager.subscribe(() => { content.invalidate(); tui.requestRender(); });
        const timer = setInterval(() => { if (workflowActive(task)) tui.requestRender(); }, 1000); timer.unref();
        return Object.assign(view, {dispose() { off(); clearInterval(timer); }});
      });
    } finally { deps.dock.setDetail(false); }
    // Close the detail frame before async actions, then reuse its reader so returning
    // from a child transcript or control keeps the same search and scroll position.
    if (!action) return;
    const manager = deps.workflows.manager;
    if (workflowControls(task).some(control => control.label === action)) await controlWorkflow(action, ctx, deps, task);
    else {
      const rows = collapse(task.workflowProgress).agents;
      selectedAgent = await selectValue(ctx, 'Workflow children', rows.map(row => ({value: String(row.index),
        label: `#${row.index} ${row.label} · ${displayState(row, workflowActive(task))}`})), selectedAgent);
      if (selectedAgent === undefined) continue;
      const row = rows.find(row => String(row.index) === selectedAgent)!;
      const state = displayState(row, workflowActive(task));
      const controls = [...row.recordId ? ['Transcript'] : [], ...row.gateJobId ? ['Gate stdout', 'Gate stderr'] : [],
        ...task.control && ['queued', 'running'].includes(state) ? ['Skip'] : [],
        ...task.control && state === 'running' ? ['Retry'] : []];
      if (!controls.length) { ctx.ui.notify('No child session or active control for this row.'); continue; }
      const control = await selectValue(ctx, `#${row.index} ${row.label}`, controls.map(label => ({value: label, label})));
      if (control === 'Transcript') {
        const record = deps.agents.manager.get(row.recordId!).record;
        await showAgent(ctx, deps.agents, deps.dock, record.id, record.runId, deps.config, false, deps.jobs);
      } else if (control?.startsWith('Gate ')) {
        const jobs = manager.jobManager(), {job, live} = await jobs.get(row.gateJobId!, await resolveWorkspace(task.cwd));
        await showJobLog(ctx, deps.dock, jobs, job, control === 'Gate stdout' ? 'stdout' : 'stderr', live);
      } else if (control === 'Skip' || control === 'Retry') {
        const accepted = control === 'Skip' ? task.control?.skip(row.index) : task.control?.retry(row.index);
        if (!accepted) ctx.ui.notify('That child has already left the control window.');
      }
    }
  }
}
interface WorkflowPage extends BrowsePage { saved?: boolean; savedState?: BrowseState }
export async function showWorkflows(ctx: ExtensionContext, deps: Deps, page: WorkflowPage): Promise<void> {
  let saved = page.saved ?? false;
  const states = [page.state, page.savedState ??= browseState()];
  states[Number(saved)].focus = page.state.focus;
  for (;;) {
    const runs = deps.workflows.list().sort((a, b) => b.startTime - a.startTime);
    const resources = {trusted: ctx.isProjectTrusted(), packageGate: deps.config().agents.packageWorkflows, agentDir: getAgentDir()};
    const names = saved ? listSavedWorkflows(ctx.cwd, resources) : [];
    const sources = new Map(names.map(name => [name, readSavedWorkflow(name, ctx.cwd, resources)]));
    const progress = new Map(runs.map(task => [task.id, new WorkflowProgress(task)]));
    let action = saved ? 'View script' : 'Open workflow', changed = false;
    const selected = await browse(ctx, deps.dock, { title: 'Subagents', state: states[Number(saved)], pages: page.pages,
      selection: item => saved ? {name: item.value} : {name: deps.workflows.manager.get(item.value).meta?.name ?? 'Workflow', id: item.value},
      controls: [{ key: 's', label: 'View', selected: () => saved ? 'saved' : 'runs',
        items: () => [{value: 'runs', label: 'Runs'}, {value: 'saved', label: 'Saved'}],
        select: (value, done) => { const previous = states[Number(saved)]; saved = value === 'saved'; page.saved = saved;
          states[Number(saved)].focus = previous.focus; changed = true; done(); } }],
      subscribe: refresh => deps.workflows.subscribe(refresh), ticking: () => !saved && deps.workflows.list().some(workflowActive),
      items: () => saved ? names.map(name => ({value: name, label: name, details: () => {
        const source = sources.get(name)!; if (!source.ok) return source.message;
        return source.script;
      }})) : deps.workflows.list().sort((a, b) => b.startTime - a.startTime).map(task => ({value: task.id, label: workflowSummary(task), details: () => {
        if (!progress.has(task.id)) progress.set(task.id, new WorkflowProgress(task));
        return progress.get(task.id)!;
      }})),
      actions: (item, done) => {
        const run = (label: string) => () => { action = label; done(item.value); };
        if (saved) return [{key: 'n', label: 'Start', run: run('Start')}];
        const task = deps.workflows.manager.get(item.value);
        return workflowControls(task).map(control => ({...control, run: run(control.label)}));
      },
    });
    if (changed) continue;
    if (selected === undefined) return;
    if (!saved) {
      const task = deps.workflows.manager.get(selected);
      if (action === 'Open workflow') await showWorkflow(ctx, deps, task);
      else await controlWorkflow(action, ctx, deps, task);
      continue;
    }
    const source = readSavedWorkflow(selected, ctx.cwd, resources);
    if (!source.ok) throw new Error(source.message);
    if (action === 'View script') await showDetails(ctx, deps.dock, selected, `\`\`\`javascript\n${source.script}\n\`\`\``);
    else if (action === 'Start') {
      const input = await ctx.ui.input('Workflow args (JSON; empty uses no args)');
      if (input === undefined) continue;
      const args: unknown = input.trim() ? JSON.parse(input) : undefined;
      const task = await deps.workflows.manager.start({name: selected, args}, deps.agents.scope(ctx), deps.config());
      await showWorkflow(ctx, deps, task);
    }
  }
}
