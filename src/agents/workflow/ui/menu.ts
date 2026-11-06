// Menu/control scope adapted from pi-subagents 0.23.0 ui/workflow-menu.ts and workflow-dialog.ts.
import { getAgentDir, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { SuiteConfig } from '../../../runtime/config.ts';
import type { Dock } from '../../../ui/dock.ts';
import { DetailsView, showDetails } from '../../../ui/details.ts';
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

type Deps = {workflows: WorkflowsModule; agents: AgentsModule; dock: Dock; config: () => SuiteConfig; jobs?: AgentJobViewer};
export async function showWorkflow(ctx: ExtensionContext, deps: Deps, task: OwnedWorkflowTask): Promise<void> {
  let reader: ScrollView | undefined, selectedAgent: string | undefined;
  const content = new WorkflowProgress(task);
  for (;;) {
    let action = '';
    deps.dock.setDetail(true);
    try {
      await ctx.ui.custom<void>((tui, _theme, _keys, done) => {
        // A workflow may settle while this detail remains open. Keep availability live,
        // so completion exposes replay and removes controls without a close/reopen cycle.
        const actions = [
          {label: 'Children / gates'},
          {label: 'Pause', available: () => workflowActive(task) && task.status !== 'paused'},
          {label: 'Resume', available: () => task.status === 'paused'},
          {label: 'Stop', available: () => workflowActive(task)},
          {label: 'Replay journal', available: () => !workflowActive(task) && Boolean(task.journalPath)},
        ];
        const view = new DetailsView(tui, () => workflowSummary(task), content, done,
          actions.map(item => ({...item, run: () => { action = item.label; done(); }})), reader);
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
    if (action === 'Pause') { if (await manager.pause(task.id)) ctx.ui.notify('Paused: running agents finish; new agents wait.'); }
    else if (action === 'Resume') await manager.resume(task.id);
    else if (action === 'Stop') await manager.stop(task.id);
    else if (action === 'Replay journal') {
      const replay = await manager.start({scriptPath: task.scriptPath, args: task.args, resumeFromRunId: task.id}, deps.agents.scope(ctx), deps.config());
      await showWorkflow(ctx, deps, replay);
    } else {
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
export async function showWorkflows(ctx: ExtensionContext, deps: Deps): Promise<void> {
  let selected: string | undefined;
  for (;;) {
    const runs = deps.workflows.list().sort((a, b) => b.startTime - a.startTime);
    selected = await selectValue(ctx, 'Workflows', [...runs.map(task => ({value: task.id, label: workflowSummary(task)})),
      {value: 'saved', label: 'Saved workflows'}], selected);
    if (selected === undefined) return;
    if (selected !== 'saved') { await showWorkflow(ctx, deps, deps.workflows.manager.get(selected)); continue; }
    const resources = {trusted: ctx.isProjectTrusted(), packageGate: deps.config().agents.packageWorkflows, agentDir: getAgentDir()};
    const names = listSavedWorkflows(ctx.cwd, resources);
    if (!names.length) { ctx.ui.notify('No saved workflows.'); continue; }
    const name = await selectValue(ctx, 'Saved workflows', names.map(name => ({value: name, label: name})));
    if (name === undefined) continue;
    const source = readSavedWorkflow(name, ctx.cwd, resources);
    if (!source.ok) throw new Error(source.message);
    const action = await selectValue(ctx, name, ['View script', 'Start'].map(label => ({value: label, label})));
    if (action === 'View script') await showDetails(ctx, deps.dock, name, `\`\`\`javascript\n${source.script}\n\`\`\``);
    else if (action === 'Start') {
      const input = await ctx.ui.input('Workflow args (JSON; empty uses no args)');
      if (input === undefined) continue;
      const args: unknown = input.trim() ? JSON.parse(input) : undefined;
      const task = await deps.workflows.manager.start({name, args}, deps.agents.scope(ctx), deps.config());
      await showWorkflow(ctx, deps, task);
    }
  }
}
