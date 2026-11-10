import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerCliPrompt } from './runtime/cli-prompt.ts';
import { registerSuiteRenderers } from './runtime/renderers.ts';

export default function piSuite(pi: ExtensionAPI): void {
  registerCliPrompt(pi);
  registerSuiteRenderers(pi);
  let activation: Promise<Awaited<ReturnType<typeof import('./runtime/suite.ts').createSuite>>> | undefined;
  pi.on('session_start', async (event, ctx) => {
    // Factories have no session cwd. One activation owns registration; session changes
    // await that same activation and then rebind its modules under the fresh context.
    activation ??= import('./runtime/suite.ts').then(({ createSuite }) => createSuite(pi, ctx));
    const bind = await activation;
    return bind(ctx, event.reason, event.previousSessionFile);
  });
}
