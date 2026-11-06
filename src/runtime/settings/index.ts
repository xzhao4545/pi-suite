import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import type { SuiteConfig } from '../config.ts';
import type { Dock } from '../../ui/dock.ts';
import type { Notifications } from '../notifications.ts';

/** Compaction can finish without agent_settled; request native shutdown after cancellation. */
export async function quit(ctx: ExtensionCommandContext): Promise<void> {
  if (!ctx.isIdle()) { ctx.abort(); await ctx.waitForIdle(); }
  ctx.shutdown();
}

export function registerSuiteCommand(pi: ExtensionAPI, dock: Dock, notices: Notifications, config: () => SuiteConfig,
  types?: (ctx: ExtensionCommandContext) => Promise<void>): void {
  // Types can refresh saved config without re-registering modules or commands.
  const active = config();
  if (active.commands.exit) pi.registerCommand('exit', { description: 'Quit Pi', handler: async (_args, ctx) => quit(ctx) });
  pi.registerCommand('suite', { description: 'Configure Pi Suite settings', handler: async (_args, ctx) => {
    const release = notices.hold();
    try {
      const { showSuiteSettings } = await import('./view.ts');
      await showSuiteSettings(ctx, dock, () => active, types ? () => types(ctx) : undefined);
    } finally { release(); }
  } });
}
