/** Refresh presentation without turning clock ticks into execution changes. */
export class PresentationTicker {
  private timer?: NodeJS.Timeout;

  constructor(private visible: () => boolean, private publish: () => void) {}

  update(active: boolean): void {
    if (!active || !this.visible()) { this.stop(); return; }
    this.timer ??= setInterval(() => {
      if (this.visible()) this.publish();
      else this.stop();
    }, 1000).unref();
  }

  stop(): void {
    clearInterval(this.timer); this.timer = undefined;
  }
}
