import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { browse, browseState, compareActivity, type BrowsePage, type BrowseState } from '../../ui/browser.ts';
import { showDetails } from '../../ui/details.ts';
import { isActive as jobActive } from '../../jobs/state.ts';
import { displayText, type DisplayField } from '../../ui/browser-chrome.ts';
import { elapsedText } from '../../ui/format.ts';
import { executionRow } from '../../ui/dock/line.ts';
import { sanitizeText } from '../../runtime/text.ts';
import { ViewerNavigation } from '../../ui/viewer/navigation.ts';
import type { SubagentsDeps } from '../commands.ts';
import { active, recordWorkspace, type AgentRecord } from '../types.ts';
import { compareRunRecency, groupAgentRuns } from '../run-groups.ts';
import { retrySuffix } from '../retry.ts';
import { agentDetails } from '../viewer-info.ts';
import { agentControls, agentMessage, performAgentAction, showAgent } from '../viewer.ts';

export const RUN_FILTERS = ['all', 'queued', 'finished'] as const;
export type RunFilter = typeof RUN_FILTERS[number];
export interface RunsState { browser: BrowseState; filter: RunFilter; workspace: boolean; selections: Map<string, string | undefined> }
export const runsState = (filter: RunFilter, workspace: boolean): RunsState => ({ browser: browseState(), filter, workspace, selections: new Map() });
const matches = (record: AgentRecord, filter: RunFilter) => filter === 'all'
  || filter === 'queued' && record.state === 'queued' || filter === 'finished' && !active(record.state);
const duration = (record: AgentRecord) => record.state === 'queued' ? `${elapsedText(Date.now() - Date.parse(record.createdAt))} wait`
  : record.elapsedMs === undefined ? 'not started' : elapsedText(record.elapsedMs);

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
  await openList(state.browser);

  async function openList(browser: BrowseState, history?: string): Promise<void> {
    const scope = agents.scope(ctx);
    const records = () => agents.manager.records().filter(record => state.workspace
      ? recordWorkspace(record) === (scope.run?.configCwd ?? ctx.cwd) && (scope.run || record.workflowId === undefined)
      : agents.manager.visible(record, scope));
    const readonly = (record: AgentRecord) => {
      const run = agents.manager.runs.get(record.runId);
      return !agents.manager.visible(record, scope) && (!run || run.settled === true);
    };
    const status = (record: AgentRecord) => agents.manager.runs.get(record.runId)?.question ? 'waiting(parent)' : record.state;
    const suffix = (record: AgentRecord) => {
      const state = status(record), retry = retrySuffix(agents.manager.runs.get(record.runId));
      const head: DisplayField[] = [{text: state, state}, ...retry ? [{text: retry, tone: 'muted' as const}] : []];
      const full: DisplayField[] = [...head, {text: ` · ${duration(record)}`, tone: 'muted'}];
      return { full, compact: [head] };
    };
    const name = (record: AgentRecord) => history ? record.runId : record.name;
    for (; !exit.closed;) {
      if (state.workspace && !discovered) { await agents.manager.discover(scope, config()); discovered = true; }
      let action = 'transcript', changed = false;
      let displayed = new Map<string, AgentRecord[]>(), latest: AgentRecord[] = [];
      const selected = await browse(ctx, dock, { title: 'Subagents', pages: history ? undefined : navigation,
        page: history ? 'Runs' : undefined, scope: history, navigation: exit, state: browser,
        total: () => latest.length, selection: item => { const [record] = displayed.get(item.value)!; return { name: record.name, id: item.value }; },
        controls: history ? undefined : [
          { key: 'w', label: 'Scope', items: () => [{ value: 'session', label: 'This session' }, { value: 'workspace', label: 'Workspace' }],
            selected: () => state.workspace ? 'workspace' : 'session', select: (value, done) => { changed = true; change(state.filter, value === 'workspace', done); } },
          { key: 's', label: 'State', items: () => RUN_FILTERS.map(filter => ({ value: filter,
            label: `${filter[0].toUpperCase()}${filter.slice(1)}`, description: String(latest.filter(record => matches(record, filter)).length) })),
            selected: () => state.filter, select: (value, done) => { changed = true; change(value as RunFilter, state.workspace, done); } }],
        subscribe: refresh => agents.manager.subscribe(refresh), ticking: () => [...displayed.values()].some(([record]) => active(record.state)),
        layout: { truncatePrimary: ({item, maxWidth, theme}) => {
          const [record] = displayed.get(item.value)!;
          const { full, compact } = suffix(record);
          return executionRow(sanitizeText(name(record)).replace(/[\r\n\t]/g, ' '), full, compact, maxWidth, theme);
        } },
        items: () => {
          // Scope before grouping so a session never exposes runs from another branch.
          const rows = history
            ? records().filter(record => record.id === history).sort(compareRunRecency).map<[string, AgentRecord[]]>(record => [record.runId, [record]])
            : [...groupAgentRuns(records())];
          latest = rows.map(([, [record]]) => record);
          displayed = new Map(history ? rows : rows.filter(([, [record]]) => matches(record, state.filter))
            .sort(([, [a]], [, [b]]) => compareActivity(a, b, record => active(record.state))));
          return Array.from(displayed, ([value, runs]) => {
            const [record] = runs;
            const display: DisplayField[] = [{text: name(record)}, {text: ' · ', tone: 'muted'}, ...suffix(record).full];
            return { value, status: status(record), label: displayText(display), display,
              search: `${record.id} ${runs.map(run => run.runId).join(' ')} ${record.name} ${record.type} ${record.state} ${record.model} ${record.prompt}`,
              details: () => agentDetails(record, undefined, readonly(record)) };
          });
        },
        actions: (item, done) => {
          const runs = displayed.get(item.value)!, [record] = runs;
          const readOnly = readonly(record), controls = agentControls(ctx, agents, record.id, record.runId, readOnly);
          const run = (value: string) => () => { action = value; done(item.value); };
          const pending = record.state === 'queued';
          return [
            { key: 'm', label: 'Message', available: controls.canMessage,
              input: () => agentMessage(ctx, agents, record.id, record.runId, readOnly, config) },
            { key: 'r', label: 'Runs', available: () => runs.length > 1, run: run('runs') },
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
      const [record] = displayed.get(selected)!;
      try {
        if (action === 'transcript' && record.state === 'queued') action = 'details';
        if (action === 'transcript') await showAgent(ctx, agents, dock, record.id, record.runId, config, readonly(record), jobs, exit);
        else if (action === 'details') await showDetails(ctx, dock, record.name, agentDetails(record), 'text', exit);
        else if (action === 'runs') await openList(browseState(), record.id);
        else await performAgentAction(action, ctx, agents, record.id, record.runId, readonly(record), config, jobs, exit);
      } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error'); }
    }
  }
}
