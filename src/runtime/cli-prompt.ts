import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export const CLI_PROMPT_FLAG = 'suite-prompt';
export const CLI_PROMPT_TRIGGER = 'pi-suite:cli-prompt';

/** Feed literal CLI text into Pi's ordinary initial-prompt path, including print/JSON. */
export function registerCliPrompt(pi: ExtensionAPI): void {
  pi.registerFlag(CLI_PROMPT_FLAG, {type: 'string', description: 'Literal initial prompt; used with the pi-suite CLI prompt trigger'});
  let pending: string | undefined;
  pi.on('session_start', event => {
    const value = pi.getFlag(CLI_PROMPT_FLAG);
    // CLI --fork starts a new activation; UI reload/new/fork must not replay the task.
    pending = event.reason === 'startup' && typeof value === 'string' ? value : undefined;
  });
  pi.on('input', event => {
    if (pending === undefined || event.source !== 'interactive' || !event.text.endsWith(CLI_PROMPT_TRIGGER)) return;
    // Native @file attachments precede the initial message; retain that text and images.
    const text = event.text.slice(0, -CLI_PROMPT_TRIGGER.length) + pending;
    pending = undefined;
    // Pi 1.5 parses @file before input hooks, even after --. The flag carries the
    // original text; restoring it here preserves native await, JSON events and input hooks.
    return {action: 'transform', text};
  });
}
