import { basename, dirname, join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import type { Execution } from './types.ts';
import { AGENT_ENTRY, resultText } from './records.ts';

/** All persistent child launches share this location; resume opens its recorded file instead. */
export function createChildSession(cwd: string, parentSession?: string, sessionDir?: string): SessionManager {
  if (sessionDir !== undefined) return SessionManager.create(cwd, sessionDir, { parentSession });
  // Pi's cwd encoding is not a public helper. create() computes it without writing a
  // session file until conversation messages arrive, so a memory parent leaves no stray file.
  const parentDir = parentSession ? dirname(parentSession) : SessionManager.create(cwd).getSessionDir();
  // Flatten nested children: Pi's non-recursive resume lists must never see these files.
  return SessionManager.create(cwd, basename(parentDir) === 'subagents' ? parentDir : join(parentDir, 'subagents'), { parentSession });
}

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
