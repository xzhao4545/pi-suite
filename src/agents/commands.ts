import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { BrowsePage } from '../ui/browser.ts';
import type { AgentsModule } from './index.ts';
import type { Dock } from '../ui/dock.ts';
import type { Notifications } from '../runtime/notifications.ts';
import type { SuiteConfig } from '../runtime/config.ts';
import type { AgentScheduler } from './schedules/index.ts';
import type { AgentJobViewer } from './viewer.ts';

export interface SubagentsDeps {
  agents: AgentsModule; dock: Dock; notices: Notifications; config: () => SuiteConfig; reload: (cwd: string) => void;
  scheduler?: AgentScheduler; workflows?: { available(): boolean; show(ctx: ExtensionContext, page: BrowsePage): Promise<void> }; jobs?: AgentJobViewer;
}
export function registerSubagentsCommand(pi: ExtensionAPI, deps: SubagentsDeps): void {
  pi.registerCommand('subagents', { description: 'Browse child runs, types, schedules, and workflows',
    handler: async (args, ctx) => { const { showSubagents } = await import('./ui/index.ts'); await showSubagents(args, ctx, deps); } });
}
