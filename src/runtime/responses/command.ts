import { SessionManager, type ExtensionAPI, type SessionEntry } from '@earendil-works/pi-coding-agent';
import { cleanBranch } from './sanitize.ts';

/** User-triggered one-shot repair. New responses continue through the normal adapter. */
export function registerResponsesCommand(pi: ExtensionAPI): void {
  pi.registerCommand('responses', {
    description: 'Fork the current branch with old Responses private state removed: /responses fork',
    getArgumentCompletions: prefix => 'fork'.startsWith(prefix) ? [{ value: 'fork', label: 'fork — clean the current history once' }] : null,
    async handler(args, ctx) {
      if (args.trim() !== 'fork') { ctx.ui.notify('Usage: /responses fork', 'info'); return; }
      if (!ctx.isIdle() || ctx.hasPendingMessages()) { ctx.ui.notify('Wait until the session is idle with no queued messages before /responses fork.', 'warning'); return; }
      if (!ctx.sessionManager.supportsPreparedFork) {
        ctx.ui.notify('This Pi host lacks prepared fork support. Run Pi with the repository-patched 1.5.0 dependencies; no session was created.', 'error'); return;
      }
      const sourceId = ctx.sessionManager.getSessionId(), leaf = ctx.sessionManager.getLeafId(), model = ctx.model;
      if (!leaf || !model || ctx.sessionManager.buildSessionProjection().messages.length === 0) { ctx.ui.notify('A current history branch and selected model are required; no session was created.', 'warning'); return; }
      const thinking = pi.getThinkingLevel();
      const assertSource = () => {
        if (ctx.sessionManager.getSessionId() !== sourceId || ctx.sessionManager.getLeafId() !== leaf || !ctx.isIdle() || ctx.hasPendingMessages()) {
          throw new Error('Source session changed while preparing fork; no clean fork was created.');
        }
      };
      // Validate before the native cancellation hook, then validate again inside preparation.
      // The host performs destination persistence and normal fork/task lifecycle only afterwards.
      let prepared: SessionEntry[];
      const report = { hadPrivateState: false };
      try { prepared = cleanBranch(structuredClone(ctx.sessionManager.getBranch()), report); assertSource(); }
      catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error'); return; }
      const result = await ctx.fork(leaf, {
          position: 'at',
          prepare: async (_entries: SessionEntry[]) => {
            assertSource();
            const copy = SessionManager.inMemory(ctx.cwd, undefined, [
              { type: 'session', version: 3, id: sourceId, timestamp: new Date().toISOString(), cwd: ctx.cwd }, ...prepared,
            ]);
            copy.appendModelChange(model.provider, model.id);
            copy.appendThinkingLevelChange(thinking);
            copy.appendCustomEntry('pi-suite:responses-fork', { version: 1, sourceSessionId: sourceId, sourceLeafId: leaf });
            return copy.getBranch();
          },
          withSession: async fresh => {
            fresh.ui.notify(`Created a clean history fork. ${report.hadPrivateState ? 'Cleared old Responses replay state.' : 'No Responses replay fields required cleanup (0).'} Model/thinking are unchanged; waiting for your next message. Account-bound files/containers and future upstream account rotation are not repaired.`, 'info');
          },
        });
      if (result.cancelled) ctx.ui.notify('Clean fork cancelled; the source session is unchanged.', 'info');
    },
  });
}
