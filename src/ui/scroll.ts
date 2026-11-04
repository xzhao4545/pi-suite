import { stripVTControlCharacters } from "node:util";
import { Input, Key, matchesKey, type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";

/** A viewport retains its own reading/search position independently of the answer editor. */
export class ScrollView implements Component {
  offset = 0;
  private height = 1;
  private lines: string[] = [];
  readonly search = new Input();
  searching = false;
  query = "";

  constructor(private content: Component) {
    this.search.onSubmit = text => { this.query = text; this.searching = false; this.find(1); };
  }
  render(width: number): string[] { return this.content.render(width); }
  viewport(width: number, height: number): string[] {
    this.height = Math.max(1, height);
    this.lines = this.content.render(width);
    this.offset = Math.min(this.offset, Math.max(0, this.lines.length - this.height));
    return this.lines.slice(this.offset, this.offset + this.height);
  }
  get position(): string { return `${this.offset + 1}/${this.lines.length}`; }
  invalidate(): void { this.content.invalidate(); }
  handleInput(data: string): void {
    if (this.searching) {
      if (matchesKey(data, Key.escape)) this.searching = false;
      else this.search.handleInput(data);
      return;
    }
    if (data === "/") { this.searching = true; return; }
    if (data === "n") { this.find(1); return; }
    if (data === "N") { this.find(-1); return; }
    if (matchesKey(data, Key.home)) this.offset = 0;
    else if (matchesKey(data, Key.end)) this.offset = Math.max(0, this.lines.length - this.height);
    else if (matchesKey(data, Key.up)) this.scroll(-1);
    else if (matchesKey(data, Key.down)) this.scroll(1);
    else if (matchesKey(data, Key.pageUp)) this.scroll(-this.height);
    else if (matchesKey(data, Key.pageDown)) this.scroll(this.height);
  }
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type !== "wheel") return;
    this.scroll((event.wheelDelta ?? 0) * 3);
    return { handled: true };
  }
  scroll(delta: number): void {
    this.offset = Math.max(0, Math.min(this.offset + delta, Math.max(0, this.lines.length - this.height)));
  }
  private find(direction: number): void {
    if (!this.query) return;
    for (let step = 1; step <= this.lines.length; step++) {
      const index = (this.offset + direction * step + this.lines.length) % this.lines.length;
      if (stripVTControlCharacters(this.lines[index]).toLocaleLowerCase().includes(this.query.toLocaleLowerCase())) {
        this.offset = index; return;
      }
    }
  }
}
