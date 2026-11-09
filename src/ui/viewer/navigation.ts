import { isKeyRelease, isKeyRepeat, matchesKey } from '@earendil-works/pi-tui';

export type ViewExit = 'back' | 'close';

/** One explicitly passed result belongs to a command's entire nested viewing chain. */
export class ViewerNavigation {
  result: ViewExit = 'back';
  get closed(): boolean { return this.result === 'close'; }
  close(): void { this.result = 'close'; }
}

/** Each component owns its pending press, so entering a child never inherits a first Left. */
export class DoubleLeft {
  private first?: number;
  constructor(private clock = Date.now) {}
  reset(): void { this.first = undefined; }
  handle(data: string): boolean {
    if (isKeyRelease(data) || isKeyRepeat(data)) return false;
    if (!matchesKey(data, 'left')) { this.reset(); return false; }
    const now = this.clock();
    if (this.first !== undefined && now - this.first <= 300) { this.reset(); return true; }
    this.first = now;
    return false;
  }
}
