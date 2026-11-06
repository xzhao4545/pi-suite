import { Key, matchesKey, truncateToWidth, visibleWidth, type KeyId } from '@earendil-works/pi-tui';

export type DetailAction = { label: string; run: () => void; key?: KeyId; available?: () => boolean; confirm?: string };

/** Detail and browser frames share availability, selection and two-step confirmation. */
export class ActionBar {
  selected?: string;
  private armed?: DetailAction;
  constructor(private source: () => DetailAction[], initial?: string, private fallback?: string) { this.selected = initial; }
  reset(initial?: string): void { this.selected = initial; this.armed = undefined; }
  disarm(): void { this.armed = undefined; }
  available(): DetailAction[] {
    const actions = this.source().filter(action => action.available?.() !== false);
    if (!actions.some(action => action.label === this.selected)) this.selected = actions.find(action => action.label === this.fallback)?.label ?? actions[0]?.label;
    if (this.armed && !actions.some(action => action.label === this.armed!.label && action.key === this.armed!.key)) this.armed = undefined;
    return actions;
  }
  get hint(): string | undefined { this.available(); return this.armed?.confirm; }
  render(width: number): string {
    const actions = this.available(), index = actions.findIndex(action => action.label === this.selected);
    if (index < 0) return '';
    const labels = actions.map(action => action.label === this.selected ? `[${action.label}]` : action.label);
    let start = index, end = index;
    const line = () => `${start ? '‹ ' : ''}${labels.slice(start, end + 1).join(' · ')}${end < labels.length - 1 ? ' ›' : ''}`;
    // Keep the selected action visible even when the complete action row cannot fit.
    while (start > 0) { start--; if (visibleWidth(line()) > width) { start++; break; } }
    while (end < labels.length - 1) { end++; if (visibleWidth(line()) > width) { end--; break; } }
    return truncateToWidth(line(), width);
  }
  handleInput(data: string): boolean {
    const actions = this.available(), shortcut = actions.find(action => action.key && matchesKey(data, action.key));
    const previous = this.armed; this.armed = undefined;
    if (shortcut) {
      if (shortcut.confirm && previous?.label !== shortcut.label) this.armed = shortcut;
      else shortcut.run();
    } else if (matchesKey(data, Key.left) || matchesKey(data, Key.right)) {
      const direction = matchesKey(data, Key.left) ? -1 : 1;
      this.selected = actions[Math.max(0, Math.min(actions.length - 1, actions.findIndex(action => action.label === this.selected) + direction))]?.label;
    } else if (matchesKey(data, Key.enter)) {
      const action = actions.find(action => action.label === this.selected);
      if (action?.confirm && previous?.label !== action.label) this.armed = action;
      else action?.run();
    } else return false;
    return true;
  }
}
