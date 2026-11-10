import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { dispatchLayoutMouse, renderLayout } from '@earendil-works/pi-tui';
import { registerCliPrompt } from './runtime/cli-prompt.ts';
import { registerSuiteRenderers } from './runtime/renderers.ts';
import { registerResponsesCommand } from './runtime/responses/command.ts';

export default function piSuite(pi: ExtensionAPI): void {
  // A bundled/global host can report 1.5.0 while exposing an unpatched virtual TUI.
  // Reject at the load boundary before any page can fail in the async renderer.
  if (typeof renderLayout !== 'function' || typeof dispatchLayoutMouse !== 'function') {
    throw new Error('Pi Suite requires the patched Node host with native layout APIs. In its repository run pnpm install, then restart with pnpm exec pi -e ./src/index.ts; /reload does not replace the host.');
  }
  registerCliPrompt(pi);
  registerSuiteRenderers(pi);
  registerResponsesCommand(pi);
  let activation: Promise<Awaited<ReturnType<typeof import('./runtime/suite.ts').createSuite>>> | undefined;
  pi.on('session_start', async (event, ctx) => {
    // Factories have no session cwd. One activation owns registration; session changes
    // await that same activation and then rebind its modules under the fresh context.
    activation ??= import('./runtime/suite.ts').then(({ createSuite }) => createSuite(pi, ctx));
    const bind = await activation;
    return bind(ctx, event.reason, event.previousSessionFile);
  });
}
