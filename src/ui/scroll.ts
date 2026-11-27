import { stripVTControlCharacters } from 'node:util';
import { Container, Input, Key, ScrollView as NativeScrollView, matchesKey,
  type Component } from '@earendil-works/pi-tui';
import { readingWindow } from './reading.ts';

/** Stable content components keep native Markdown/tool caches while the shared reader clips lines. */
class ReadingContent extends Container {
  constructor(content: Component, private measured: (lines: string[]) => void) { super(); this.addChild(content); }
  override render(width: number): string[] { const lines = super.render(width); this.measured(lines); return lines; }
}

/** Search is an index, not a second viewport: Pi owns clipping, follow-end and the only offset. */
export class ScrollView extends NativeScrollView {
  private lines: string[] = [];
  private document: ReadingContent;
  private content: Component;
  readonly search = new Input();
  searching = false;
  query = '';
  hasNewOutput = false;
  onScroll?: () => void;

  constructor(content: Component, following = false) {
    const document = new ReadingContent(content, lines => this.measured(lines));
    // Reading is keyboard-driven; a hidden native scrollbar creates no activity timers.
    super(document, {follow: 'end', scrollbar: 'hidden', overscroll: 'contain'});
    this.document = document; this.content = content;
    this.scrollTo(0, {disableFollow: !following});
    this.search.onSubmit = text => { this.query = text; this.searching = false; this.find(1); };
  }
  get offset(): number { return this.scrollTop; }
  set offset(value: number) { this.scrollTo(value, {disableFollow: true}); }
  get following(): boolean { return this.isFollowingEnd; }
  follow(): void { this.scrollToEnd(); this.hasNewOutput = false; }
  pause(): void { this.scrollTo(this.offset, {disableFollow: true}); }
  markNewOutput(): void { if (!this.following) this.hasNewOutput = true; }
  private measured(lines: string[]): void {
    // Source events mark unread output. Layout growth (for example expanding a tool)
    // only updates the search index and must not masquerade as provider output.
    this.lines = lines;
  }
  override updateLayout(contentHeight: number, viewportHeight: number, requestRender: () => void): void {
    const paused = !this.following;
    super.updateLayout(contentHeight, viewportHeight, requestRender);
    // Stock Pi can enable follow when a shrinking document clamps to its end. Layout
    // is not a navigation action: retain an explicit pause using its public API.
    if (paused) super.scrollTo(this.offset, {disableFollow: true});
    if (this.following) this.hasNewOutput = false;
  }
  override scrollBy(lines: number): number {
    const offset = this.offset, following = this.following;
    const remaining = super.scrollBy(lines);
    if (offset !== this.offset || following !== this.following) this.onScroll?.();
    return remaining;
  }
  override scrollTo(offset: number, options?: Parameters<NativeScrollView['scrollTo']>[1]): void {
    const previous = this.offset, following = this.following;
    super.scrollTo(offset, options);
    if (previous !== this.offset || following !== this.following) this.onScroll?.();
  }
  override scrollToEnd(): void {
    const offset = this.offset, following = this.following;
    super.scrollToEnd();
    if (offset !== this.offset || following !== this.following) this.onScroll?.();
  }
  /** Stock ScrollView owns the only offset; overlays supply explicit clipping and height. */
  viewport(width: number, height: number, requestRender: () => void = () => {}): string[] {
    const lines = super.render(width);
    this.updateLayout(lines.length, height, requestRender);
    return readingWindow(lines.slice(this.offset, this.offset + height), height);
  }
  get position(): string { return `${this.lines.length ? this.offset + 1 : 0}/${this.lines.length}`; }
  get atBottom(): boolean { return this.offset >= Math.max(0, this.lines.length - this.viewportHeight); }
  setContent(content: Component): void {
    if (this.content === content) return;
    this.content = content; this.document.clear(); this.document.addChild(content);
  }
  dispose(): void {
    this.onScroll = undefined;
    // Detach the public layout callback without resetting the retained reading state.
    this.updateLayout(this.lines.length, this.viewportHeight, () => {});
  }
  handleInput(data: string): void {
    if (this.searching) {
      if (matchesKey(data, Key.escape)) this.searching = false;
      else this.search.handleInput(data);
      return;
    }
    if (data === '/') { this.pause(); this.searching = true; return; }
    if (data === 'n') { this.find(1); return; }
    if (data === 'N') { this.find(-1); return; }
    if (matchesKey(data, Key.home)) this.scrollTo(0, {disableFollow: true});
    else if (matchesKey(data, Key.end)) this.follow();
    else if (matchesKey(data, Key.up)) this.scroll(-1);
    else if (matchesKey(data, Key.down)) this.scroll(1);
    else if (matchesKey(data, Key.pageUp)) this.scroll(-this.viewportHeight);
    else if (matchesKey(data, Key.pageDown)) this.scroll(this.viewportHeight);
  }
  scroll(delta: number): void { this.scrollBy(delta); if (this.following) this.hasNewOutput = false; }
  private find(direction: number): void {
    if (!this.query) return;
    const query = this.query.toLocaleLowerCase();
    for (let step = 1; step <= this.lines.length; step++) {
      const index = (this.offset + direction * step + this.lines.length) % this.lines.length;
      if (stripVTControlCharacters(this.lines[index]).toLocaleLowerCase().includes(query)) {
        this.scrollTo(index, {disableFollow: true}); return;
      }
    }
  }
}
