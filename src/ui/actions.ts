import { matchesKey, truncateToWidth, wrapTextWithAnsi, type KeyId } from '@earendil-works/pi-tui';

/**
 * Every action is reached by its own key, so the bar never holds a cursor that can
 * disagree with what Enter does. Several actions may share a key when their
 * availability is mutually exclusive (Pause/Resume, Stop subtree/Cleanup jobs).
 */
export type DetailAction = { key: KeyId; label: string; run: () => void; available?: () => boolean; confirm?: boolean };

export const keyLabel = (key: KeyId): string => key === 'enter' ? 'Enter' : key;
/** Desktop widths show every key; phone widths may truncate without stealing body height. */
export const keyHelp = (text: string, width: number): string[] => width >= 80 ? wrapTextWithAnsi(text, width) : [truncateToWidth(text, width)];

/** Detail and browser frames share availability and two-step confirmation. */
export class ActionBar {
  private armed?: DetailAction;
  constructor(private source: () => DetailAction[]) {}
  disarm(): void { this.armed = undefined; }
  available(): DetailAction[] {
    const actions = this.source().filter(action => action.available?.() !== false);
    if (this.armed && !actions.some(action => action.label === this.armed!.label && action.key === this.armed!.key)) this.armed = undefined;
    return actions;
  }
  /** One confirmation wording for every destructive key keeps the prompt in the UI's language. */
  get hint(): string | undefined {
    this.available();
    return this.armed && `Press ${keyLabel(this.armed.key)} again to ${this.armed.label.toLowerCase()} · any other key cancels`;
  }
  render(): string { return this.available().map(action => `${keyLabel(action.key)} ${action.label}`).join(' · '); }
  /** Any other key cancels a pending confirmation, so a stray second press cannot act on new state. */
  handleInput(data: string): boolean {
    const action = this.available().find(action => matchesKey(data, action.key));
    const previous = this.armed; this.armed = undefined;
    if (!action) return false;
    // Sources rebuild action objects per call; identity is the key and label pair.
    if (action.confirm && (previous?.key !== action.key || previous.label !== action.label)) this.armed = action;
    else action.run();
    return true;
  }
}
