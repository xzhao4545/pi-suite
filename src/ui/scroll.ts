import { stripVTControlCharacters } from 'node:util';
import { Container, Input, Key, ScrollView as NativeScrollView, dispatchLayoutMouse, renderLayout, matchesKey,
  type Component, type LayoutFrame, type TuiMouseEvent } from '@earendil-works/pi-tui';

/** A real child container keeps Pi's tool regions reachable, including legacy viewport consumers. */
class ReadingContent extends Container {
  constructor(content: Component, private measured: (lines: string[]) => void) { super(); this.addChild(content); }
  override render(width: number): string[] { const lines = super.render(width); this.measured(lines); return lines; }
}

/** Search is an index, not a second viewport: Pi owns clipping, follow-end and the only offset. */
export class ScrollView extends NativeScrollView {
  private lines: string[] = [];
  private document: ReadingContent;
  private content: Component;
  private viewportFrame?: LayoutFrame;
  readonly search = new Input();
  searching = false;
  query = '';
  hasNewOutput = false;
  onScroll?: () => void;

  constructor(content: Component, following = false) {
    const document = new ReadingContent(content, lines => this.measured(lines));
    super(document, {follow: 'end', scrollbar: 'auto', overscroll: 'contain'});
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
    super.updateLayout(contentHeight, viewportHeight, requestRender);
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
  prepareLayout(): void { this.viewportFrame = undefined; }
  /** Consumers with a line-based surrounding frame still use Pi's complete native layout. */
  viewport(width: number, height: number, requestRender: () => void = () => {}): string[] {
    this.viewportFrame = renderLayout(this, width, height, requestRender);
    return this.viewportFrame.lines;
  }
  get position(): string { return `${this.lines.length ? this.offset + 1 : 0}/${this.lines.length}`; }
  get atBottom(): boolean { return this.offset >= Math.max(0, this.lines.length - this.viewportHeight); }
  setContent(content: Component): void {
    if (this.content === content) return;
    this.content = content; this.document.clear(); this.document.addChild(content);
  }
  override dispose(): void { super.dispose(); this.viewportFrame = undefined; }
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
  override handleMouse(event: TuiMouseEvent): ReturnType<NativeScrollView['handleMouse']> {
    if (!this.viewportFrame) return undefined; // Mounted layout nodes are routed by Pi, not again here.
    if (event.type === 'wheel') {
      this.scroll(event.wheelDelta ?? 0);
      return {handled: true, target: {component: this, originX: event.screenX - event.x, originY: event.screenY - event.y, width: event.width, height: event.height}};
    }
    const local = {...event, screenX: event.x, screenY: event.y};
    // Skip this scroll node while forwarding the stored geometry to the actual document.
    const result = dispatchLayoutMouse({...this.viewportFrame, root: this.viewportFrame.root.children[0]}, local);
    return result && {...result, target: {...result.target,
      originX: result.target.originX + event.screenX - event.x,
      originY: result.target.originY + event.screenY - event.y}};
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
