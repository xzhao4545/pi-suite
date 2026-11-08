import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { ViewerDeps } from './viewer.ts';

export function registerJobsCommand(pi: ExtensionAPI, deps: ViewerDeps): void {
  pi.registerCommand('jobs', { description: 'Browse jobs: [finished|all] [workspace]; filter records, read logs, attach and stop',
    handler: async (args, ctx) => { const { showJobs } = await import('./viewer.ts'); await showJobs(pi, args, ctx, deps); } });
}
