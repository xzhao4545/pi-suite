import type { Execution } from './types.ts';
import { AGENT_ENTRY, resultText } from './records.ts';

/** Closing retained sessions must stay available without loading a new child execution stack. */
export async function closeAgent(run: Execution): Promise<void> {
  const session = run.session;
  if (!session) return;
  try {
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
    run.record.sessionFile = session.sessionManager.getSessionFile();
    run.record.endLeafId = session.sessionManager.getLeafId();
    run.record.result ??= resultText(session.sessionManager.getBranch());
    run.record.contextUsage = session.getContextUsage();
    session.sessionManager.appendCustomEntry(AGENT_ENTRY, { ...run.record });
    run.entries = session.sessionManager.getBranch(run.record.endLeafId ?? undefined);
  } finally { session.dispose(); run.session = undefined; }
}
