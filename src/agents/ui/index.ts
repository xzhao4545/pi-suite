import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { browseState, type BrowseChoice } from '../../ui/browser.ts';
import { ViewerNavigation } from '../../ui/viewer/navigation.ts';
import type { SubagentsDeps } from '../commands.ts';
import { showSchedules } from '../schedules/menu.ts';
import { showAgentTypes } from './types.ts';
import { RUN_FILTERS, runsState, showRuns, type RunFilter } from './runs.ts';

export async function showSubagents(args: string, ctx: ExtensionContext, deps: SubagentsDeps): Promise<void> {
  if (ctx.mode !== 'tui') { ctx.ui.notify('Use agent_list and agent_read outside the terminal UI'); return; }
  const words = args.trim().split(/\s+/).filter(Boolean), command = words[0] ?? 'all';
  const pages = ['runs', 'types', ...deps.scheduler?.isActive ? ['schedules'] : [], ...deps.workflows?.available() ? ['workflows'] : []];
  if (!(RUN_FILTERS as readonly string[]).includes(command) && command !== 'workspace' && !pages.includes(command)
    || words.length > (command === 'workspace' ? 2 : 1) || command === 'workspace' && words[1] && !(RUN_FILTERS as readonly string[]).includes(words[1])) {
    throw new Error('Use /subagents [queued|finished|all|types|schedules|workflows] or /subagents workspace [queued|finished|all]');
  }
  let page = pages.includes(command) ? command : 'runs';
  const runs = runsState((command === 'workspace' ? words[1] ?? 'all' : (RUN_FILTERS as readonly string[]).includes(command) ? command : 'all') as RunFilter, command === 'workspace');
  const exit = new ViewerNavigation();
  const states = new Map(pages.map(page => [page, page === 'runs' ? runs.browser : browseState()]));
  let next: string | undefined;
  // Every page shares one switcher; each keeps its own list state so returning restores its selection.
  const navigation: BrowseChoice = { selected: () => page,
    items: () => pages.map(value => ({ value, label: `${value[0].toUpperCase()}${value.slice(1)}` })),
    select: (value, done) => { next = value; done(); } };
  const frames = new Map(pages.map(page => [page, { state: states.get(page)!, pages: navigation, navigation: exit }]));
  const release = deps.notices.hold();
  try { for (; !exit.closed;) {
    next = undefined;
    const frame = frames.get(page)!;
    if (page === 'runs') await showRuns(ctx, deps, runs, navigation, exit);
    else if (page === 'types') await showAgentTypes(ctx, deps.dock, deps.config, deps.reload, frame);
    else if (page === 'schedules') await showSchedules(ctx, deps.scheduler!, deps.dock, frame);
    else await deps.workflows!.show(ctx, frame);
    if (!next || exit.closed) return;
    page = next;
  } } finally { release(); }
}
