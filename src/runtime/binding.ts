import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface Binding {
  readonly generation: number;
  readonly sessionId: string;
  readonly ctx: ExtensionContext;
}

export class SessionBinding {
  private generation = 0;
  current?: Binding;

  bind(ctx: ExtensionContext): Binding {
    this.current = { generation: ++this.generation, sessionId: ctx.sessionManager.getSessionId(), ctx };
    return this.current;
  }

  revoke(): void {
    ++this.generation;
    this.current = undefined;
  }

  isCurrent(binding: Binding): boolean {
    return this.current === binding;
  }
}
