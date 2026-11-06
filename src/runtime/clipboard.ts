import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';

/** Pi already emits OSC 52. tmux's default "external" rejects requests from applications. */
export async function prepareClipboard(pi: Pick<ExtensionAPI, 'exec'>, ctx: ExtensionContext): Promise<void> {
  if (ctx.mode !== 'tui' || !process.env.TMUX) return;
  const inspect = await pi.exec('tmux', ['display-message', '-p', '#{set-clipboard}|#{client_termfeatures}']);
  if (inspect.code !== 0) throw new Error(`Cannot inspect tmux clipboard: ${inspect.stderr}`);
  const [mode, features] = inspect.stdout.trim().split('|');
  if (!features?.split(',').includes('clipboard')) {
    ctx.ui.notify('The tmux client has no clipboard capability. Enable OSC 52 in the SSH terminal and its tmux terminal-features before copying.', 'warning');
    return;
  }
  if (mode === 'on') return;
  const changed = await pi.exec('tmux', ['set-option', '-s', 'set-clipboard', 'on']);
  if (changed.code !== 0) throw new Error(`Cannot enable tmux application clipboard: ${changed.stderr}`);
}
