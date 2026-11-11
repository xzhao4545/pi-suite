import type { Theme, ToolRenderers } from '@earendil-works/pi-coding-agent';
import type { Component } from '@earendil-works/pi-tui';
import { CodeComponent, type CodeSource, type CommandShell } from './command.ts';

type CallArgs = { command?: unknown; timeout?: number } | undefined;
/** The native slot is still invoked: it owns the live timer and argument diagnostics. */
class CommandCall implements Component {
  native?: Component;
  private highlighted?: CodeComponent;
  update(args: CallArgs, shell: CommandShell, theme: Theme): void {
    if (typeof args?.command !== 'string' || !args.command) { this.highlighted = undefined; return; }
    const source: CodeSource = { code: args.command, language: shell, mode: 'command', theme,
      prefix: theme.fg('toolTitle', theme.bold(shell === 'powershell' ? 'PS> ' : '$ ')),
      suffix: args.timeout ? theme.fg('muted', ` (timeout ${args.timeout}s)`) : '' };
    this.highlighted ??= new CodeComponent(source);
    this.highlighted.setSource(source);
  }
  invalidate(): void { this.native?.invalidate(); this.highlighted?.invalidate(); }
  render(width: number): string[] { return (this.highlighted ?? this.native!).render(width); }
}

/** Decorates display only. Default shell, result slot, images, timeout/output and expansion stay native. */
export function builtinCommandRenderers(base: ToolRenderers, shell: CommandShell,
  enabled: (cwd: string) => boolean): ToolRenderers {
  // Third-party execution shells must not acquire a second frame or lose their own call composition.
  if (base.renderShell === 'self' || !base.renderCall) return base;
  return { ...base, renderCall(args, theme, ctx) {
    if (!enabled(ctx.cwd)) return base.renderCall!(args, theme, ctx);
    const component = ctx.lastComponent instanceof CommandCall ? ctx.lastComponent : new CommandCall();
    component.native = base.renderCall!(args, theme, { ...ctx, lastComponent: component.native });
    component.update(args as CallArgs, shell, theme);
    return component;
  } };
}
