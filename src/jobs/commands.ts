import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { ViewerDeps } from './viewer.ts';

export function registerJobsCommand(pi: ExtensionAPI, deps: ViewerDeps): void {
  pi.registerCommand('jobs', { description: 'Browse jobs, logs and terminals: [finished|all] [workspace]',
    handler: async (args, ctx) => { const { showJobs } = await import('./viewer.ts'); await showJobs(pi, args, ctx, deps); } });
}
