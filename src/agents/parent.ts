import type { ParentScope } from './types.ts';

/** Pi context getters are revoked on reload; queued and workflow execution retain facts instead. */
export function captureParent(scope: ParentScope): ParentScope {
  const { ctx } = scope, trusted = ctx.isProjectTrusted(), systemPrompt = ctx.getSystemPrompt();
  const sessionManager = ctx.sessionManager;
  return { ...scope,
    ctx: { cwd: ctx.cwd, model: ctx.model, modelRegistry: ctx.modelRegistry, thinkingLevel: ctx.thinkingLevel,
      sessionManager, isProjectTrusted: () => trusted, getSystemPrompt: () => systemPrompt },
    owner: scope.owner ?? { ownerSessionId: scope.run?.record.ownerSessionId ?? sessionManager.getSessionId(),
      anchorEntryId: scope.run ? scope.run.record.anchorEntryId : sessionManager.getLeafId() },
  };
}
