import { createWriteStream } from 'node:fs';
import { constants } from 'node:os';
import { performance } from 'node:perf_hooks';
import { PtyTerminalSession } from '../terminal/session.ts';
import type { ResolvedShellConfig } from '../terminal/shell.ts';
import { trackIdentity, type Tracked } from './process.ts';
import type { ExitObservation } from '../types.ts';

const SIGNAL_NAMES = Object.fromEntries(Object.entries(constants.signals).map(([name, value]) => [value, name]));

/**
 * PTY job: program bytes are appended to output.log in arrival order (the history source),
 * while the headless terminal keeps the live screen for attach. Exit is reported only after
 * the log stream has flushed, so a settled job never has a shorter log than its screen.
 */
export async function launchPty(input: { command: string; cwd: string; shell: ResolvedShellConfig; outputPath: string; cols: number; rows: number }): Promise<Tracked> {
  const log = createWriteStream(input.outputPath, { flags: 'a', mode: 0o600 });
  const opened = Promise.withResolvers<void>();
  log.once('open', () => opened.resolve()); log.once('error', opened.reject);
  await opened.promise;
  let logError: string | undefined;
  log.on('error', error => { logError = String(error); });
  let session: PtyTerminalSession;
  try {
    session = new PtyTerminalSession({ command: input.command, shellConfig: input.shell, cwd: input.cwd,
      cols: input.cols, rows: input.rows, sink: data => log.write(data) });
  } catch (error) { log.destroy(); throw error; }
  const exit = Promise.withResolvers<ExitObservation>();
  const run: Tracked = {
    pid: session.pid, spawnedAt: Date.now(), startedMonotonic: performance.now(), exited: exit.promise,
    identity: Promise.resolve(undefined), knownResidual: false, terminal: session,
    write: data => session.write(data), resize: (cols, rows) => session.resize(cols, rows),
    dispose: () => session.dispose(),
  };
  void session.exit.promise.then(({ exitCode, signal }) => {
    const flushed = Promise.withResolvers<void>();
    log.end(() => flushed.resolve());
    return flushed.promise.then(() => {
      run.exitObserved = { code: signal ? null : exitCode, signal: signal ? (SIGNAL_NAMES[signal] ?? String(signal)) : null, ...(logError ? { error: logError } : {}) };
      exit.resolve(run.exitObserved);
    });
  });
  trackIdentity(run);
  return run;
}
