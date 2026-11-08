import { stripVTControlCharacters } from 'node:util';
import { Input, Key, ScrollView as NativeScrollView, matchesKey, type Component, type TuiMouseEvent, type TuiMouseEventResult } from '@earendil-works/pi-tui';

/** Reading/search adds no second scrolling state: Pi owns persistent follow-end and offsets. */
export class ScrollView implements Component {
  private native: NativeScrollView;
  private lines: string[] = [];
  private width = 0;
  readonly search = new Input();
  searching = false;
  query = '';
  hasNewOutput = false;

  constructor(private content: Component, following = false) {
    this.native = new NativeScrollView({ render: width => this.content.render(width), invalidate: () => this.content.invalidate() }, {follow: 'end'});
    this.native.scrollTo(0, {disableFollow: !following});
    this.search.onSubmit = text => { this.query = text; this.searching = false; this.find(1); };
  }
  get offset(): number { return this.native.scrollTop; }
  set offset(value: number) { this.native.scrollTo(value, {disableFollow: true}); }
  get following(): boolean { return this.native.isFollowingEnd; }
  follow(): void { this.native.scrollToEnd(); this.hasNewOutput = false; }
  pause(): void { this.native.scrollTo(this.offset, {disableFollow: true}); }
  markNewOutput(): void { if (!this.following) this.hasNewOutput = true; }
  render(width: number): string[] { return this.native.render(width); }
  viewport(width: number, height: number): string[] {
    const lines = this.render(width);
    // Compare rendered lines, not entry identities: a stable streaming component can still grow.
    // Only appended lines below the viewport are "new output"; in-place edits such as an elapsed
    // timer in a record summary are already visible and must not light up the hint. Resizing
    // alone is layout, not new output.
    if (width === this.width && this.lines.length && lines.length > this.lines.length
      && lines.length > this.offset + this.native.viewportHeight) this.markNewOutput();
    this.lines = lines; this.width = width;
    this.native.updateLayout(lines.length, Math.max(1, height), () => {});
    if (this.following) this.hasNewOutput = false;
    return lines.slice(this.offset, this.offset + this.native.viewportHeight);
  }
  get position(): string { return `${this.offset + 1}/${this.lines.length}`; }
  get atBottom(): boolean { return this.offset >= Math.max(0, this.lines.length - this.native.viewportHeight); }
  /** Content refresh never overrides the user's reading/following choice. */
  setContent(content: Component): void { this.content = content; }
  invalidate(): void { this.content.invalidate(); }
  handleInput(data: string): void {
    if (this.searching) {
      if (matchesKey(data, Key.escape)) this.searching = false;
      else this.search.handleInput(data);
      return;
    }
    if (data === '/') { this.pause(); this.searching = true; return; }
    if (data === 'n') { this.find(1); return; }
    if (data === 'N') { this.find(-1); return; }
    if (matchesKey(data, Key.home)) this.native.scrollToStart();
    else if (matchesKey(data, Key.end)) this.follow();
    else if (matchesKey(data, Key.up)) this.scroll(-1);
    else if (matchesKey(data, Key.down)) this.scroll(1);
    else if (matchesKey(data, Key.pageUp)) this.scroll(-this.native.viewportHeight);
    else if (matchesKey(data, Key.pageDown)) this.scroll(this.native.viewportHeight);
  }
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type !== 'wheel') return;
    this.scroll((event.wheelDelta ?? 0) * 3);
    return {handled: true};
  }
  scroll(delta: number): void {
    this.native.scrollBy(delta);
    if (this.following) this.hasNewOutput = false;
  }
  private find(direction: number): void {
    if (!this.query) return;
    for (let step = 1; step <= this.lines.length; step++) {
      const index = (this.offset + direction * step + this.lines.length) % this.lines.length;
      if (stripVTControlCharacters(this.lines[index]).toLocaleLowerCase().includes(this.query.toLocaleLowerCase())) {
        this.native.scrollTo(index, {disableFollow: true}); return;
      }
    }
  }
}
