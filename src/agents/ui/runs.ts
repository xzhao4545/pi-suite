import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { browse, browseState, compareActivity, type BrowsePage, type BrowseState } from '../../ui/browser.ts';
import { showDetails } from '../../ui/details.ts';
import { isActive as jobActive } from '../../jobs/state.ts';
import { displayText, type DisplayField } from '../../ui/browser-chrome.ts';
import { executionRow } from '../../ui/dock/line.ts';
import { sanitizeText } from '../../runtime/text.ts';
import { ViewerNavigation } from '../../ui/viewer/navigation.ts';
import type { SubagentsDeps } from '../commands.ts';
import { active, recordWorkspace, type AgentRecord } from '../types.ts';
import { agentDetails } from '../viewer-info.ts';
import { agentControls, agentMessage, performAgentAction, showAgent } from '../viewer.ts';

export const RUN_FILTERS = ['all', 'queued', 'finished'] as const;
export type RunFilter = typeof RUN_FILTERS[number];
export interface RunsState { browser: BrowseState; filter: RunFilter; workspace: boolean; selections: Map<string, string | undefined> }
export const runsState = (filter: RunFilter, workspace: boolean): RunsState => ({ browser: browseState(), filter, workspace, selections: new Map() });
const matches = (record: AgentRecord, filter: RunFilter) => filter === 'all'
  || filter === 'queued' && record.state === 'queued' || filter === 'finished' && !active(record.state);
const duration = (record: AgentRecord) => record.state === 'queued' ? `${Math.max(0, (Date.now() - Date.parse(record.createdAt)) / 1000).toFixed(1)}s wait`
  : record.elapsedMs === undefined ? 'not started' : `${(record.elapsedMs / 1000).toFixed(1)}s`;

export async function showRuns(ctx: ExtensionContext, deps: SubagentsDeps, state: RunsState, navigation: BrowsePage['pages'], exit = new ViewerNavigation()): Promise<void> {
  const { agents, dock, config, jobs } = deps;
  let discovered = false;
  const change = (filter: RunFilter, workspace: boolean, done: () => void) => {
    state.selections.set(`${state.workspace}:${state.filter}`, state.browser.selected);
    // Re-entering the workspace refreshes external history; text filtering only reads snapshots.
    if (workspace && !state.workspace) discovered = false;
    state.filter = filter; state.workspace = workspace;
    state.browser.selected = state.selections.get(`${workspace}:${filter}`);
    done();
  };
  for (; !exit.closed;) {
    const scope = agents.scope(ctx);
    if (state.workspace && !discovered) { await agents.manager.discover(scope, config()); discovered = true; }
    const records = () => agents.manager.records().filter(record => state.workspace
      ? recordWorkspace(record) === (scope.run?.configCwd ?? ctx.cwd) && (scope.run || record.workflowId === undefined)
      : agents.manager.visible(record, scope));
    const readonly = (record: AgentRecord) => {
      const run = agents.manager.get(record.id, record.runId).run;
      return !agents.manager.visible(record, scope) && (!run || run.settled === true);
    };
    let action = 'transcript', changed = false, displayed = new Map<string, AgentRecord>();
    const selected = await browse(ctx, dock, { title: 'Subagents', pages: navigation, navigation: exit, state: state.browser,
      total: () => records().length, selection: item => { const record = displayed.get(item.value)!; return { name: record.name, id: record.id }; },
      controls: [
        { key: 'w', label: 'Scope', items: () => [{ value: 'session', label: 'This session' }, { value: 'workspace', label: 'Workspace' }],
          selected: () => state.workspace ? 'workspace' : 'session', select: (value, done) => { changed = true; change(state.filter, value === 'workspace', done); } },
        { key: 's', label: 'State', items: () => { const visible = records(); return RUN_FILTERS.map(filter => ({ value: filter,
          label: `${filter[0].toUpperCase()}${filter.slice(1)}`, description: String(visible.filter(record => matches(record, filter)).length) })); },
          selected: () => state.filter, select: (value, done) => { changed = true; change(value as RunFilter, state.workspace, done); } }],
      subscribe: refresh => agents.manager.subscribe(refresh), ticking: () => records().some(record => active(record.state)),
      layout: { truncatePrimary: ({item, maxWidth, theme}) => {
        const record = displayed.get(item.value)!;
        const state = agents.manager.get(record.id, record.runId).run?.question ? 'waiting(parent)' : record.state;
        return executionRow(sanitizeText(record.name).replace(/[\r\n\t]/g, ' '),
          [{text: state, state}, {text: ` · ${duration(record)}`, tone: 'muted'}], [[{text: state, state}]], maxWidth, theme);
      } },
      items: () => {
        const rows = records().filter(record => matches(record, state.filter)).sort((a, b) => compareActivity(a, b, record => active(record.state)));
        displayed = new Map(rows.map(record => [record.runId, record]));
        return rows.map(record => {
          const state = agents.manager.get(record.id, record.runId).run?.question ? 'waiting(parent)' : record.state;
          const display: DisplayField[] = [{text: record.name}, {text: ' · ', tone: 'muted'}, {text: state, state}, {text: ` · ${duration(record)}`, tone: 'muted'}];
        return { value: record.runId, status: state, label: displayText(display), display,
          search: `${record.id} ${record.runId} ${record.name} ${record.type} ${record.state} ${record.model} ${record.prompt}`,
          details: () => `${readonly(record) ? 'Read only\n' : ''}${agentDetails(record)}` };
        });
      },
      actions: (item, done) => {
        const record = displayed.get(item.value)!;
        const readOnly = readonly(record), controls = agentControls(ctx, agents, record.id, record.runId, readOnly);
        const run = (value: string) => () => { action = value; done(item.value); };
        const pending = record.state === 'queued';
        return [
          { key: 'm', label: 'Message', available: controls.canMessage,
            input: () => agentMessage(ctx, agents, record.id, record.runId, readOnly, config) },
          ...jobs ? [{ key: 'j' as const, label: 'Jobs', run: run('jobs') }] : [],
          { key: 'c', label: 'Model / thinking', available: () => !readOnly, run: run('model') },
          { key: 'b', label: 'Background', available: () => !readOnly && agents.manager.canSendToBackground(record.id, record.runId), run: run('background') },
          { label: pending ? 'Cancel queued' : 'Stop subtree', key: 'x', confirm: true, available: controls.canStop, run: run('stop') },
          { label: 'Cleanup jobs', key: 'x', confirm: true,
            available: () => !readOnly && !active(record.state) && Boolean(jobs?.viewer.jobs.createdBy([record.runId]).some(jobActive)), run: run('stop') },
        ];
      },
    });
    if (changed) continue;
    if (selected === undefined || exit.closed) return;
    const record = records().find(record => record.runId === selected);
    if (!record) continue;
    try {
      if (action === 'transcript' && record.state === 'queued') action = 'details';
      if (action === 'transcript') await showAgent(ctx, agents, dock, record.id, record.runId, config, readonly(record), jobs, exit);
      else if (action === 'details') await showDetails(ctx, dock, record.name, agentDetails(record), 'text', exit);
      else await performAgentAction(action, ctx, agents, record.id, record.runId, readonly(record), config, jobs, exit);
    } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error'); }
  }
}
