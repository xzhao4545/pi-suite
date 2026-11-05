import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { AskManager } from '../../ask/index.ts';
import type { SuiteConfig } from '../../runtime/config.ts';
import { ToolError } from '../../runtime/errors.ts';

/** One explicit permission for the final command, using the same queue and binding as ask_user. */
export async function authorizeLaunch(command: string, cwd: string, ctx: ExtensionContext,
  config: SuiteConfig, ask: AskManager, signal?: AbortSignal): Promise<void> {
  const decision = config.jobs.launchPolicy(command);
  if (decision === 'allow') return;
  if (decision === 'deny') throw new ToolError('LAUNCH_DENIED', 'This exact command is denied by user jobs.launchPolicy');
  if (ctx.mode !== 'tui') throw new ToolError('LAUNCH_CONFIRMATION_REQUIRED', 'This command requires confirmation in an interactive terminal; configure an exact user-level allow rule to launch without UI');
  const { result } = await ask.ask({
    question: 'Allow this job command once?',
    context: `cwd: ${JSON.stringify(cwd)}\n\nExact command:\n${JSON.stringify(command)}`,
    options: [{ id: 'allow', title: 'Allow once' }, { id: 'deny', title: 'Do not launch' }],
    allowFreeform: false,
  }, ctx, config, signal, 'job launch');
  if (result.status !== 'answered') throw new ToolError('LAUNCH_NOT_CONFIRMED', `Job not started: launch question ${result.status}`);
  const answer = result.responses[0];
  if (answer.kind !== 'selection' || !answer.optionIds.includes('allow')) throw new ToolError('LAUNCH_DENIED', 'The user declined this job command');
}
