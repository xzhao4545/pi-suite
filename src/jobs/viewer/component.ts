import type { KeybindingsManager, Theme } from '@earendil-works/pi-coding-agent';
import { Key, Text, VStack, HStack, renderLayout, matchesKey, truncateToWidth, type Component, type TUI, type TuiMouseEvent } from '@earendil-works/pi-tui';
import { DetailsView } from '../../ui/details.ts';
import { ScrollView } from '../../ui/scroll.ts';
import { separator, focusLabel } from '../../ui/browser-chrome.ts';
import { readingRows, readingText } from '../../ui/reading.ts';
import { commandComponent } from '../../ui/rendering/command.ts';
import { DoubleLeft, type ViewerNavigation } from '../../ui/viewer/navigation.ts';
import { TerminalView, type TerminalExit, type TerminalSource, type TerminalKeys } from '../../ui/terminal.ts';
import type { DetailAction } from '../../ui/actions.ts';
import { sanitizeText } from '../../runtime/text.ts';
import type { JobControl } from '../control.ts';
import type { JobManager } from '../manager.ts';
import { JobLogView } from '../log-viewer.ts';
import { jobDetail, streamsOf } from '../query.ts';
import { isActive } from '../state.ts';
import type { JobSummary, Stream } from '../types.ts';
import { jobRow } from './metadata.ts';

export interface JobViewOptions {
  job: JobSummary; live: boolean; readonly: boolean; control: JobControl;
  source?: TerminalSource; manager?: JobManager; keys: TerminalKeys; navigation: ViewerNavigation;
}

/** Command/output is one interaction; details swap its body, not another modal/menu. */
export class JobView extends VStack {
  focused = true;
  readonly capturesViewportInput = true;
  readonly command: ScrollView;
  private bodyTui: TUI;
  private bodyRows = 1;
  private commandRows = 1;
  private commandFocus = false;
  private expanded = false;
  private doubleLeft = new DoubleLeft();
  private streams = new Map<Stream, JobLogView>();
  private terminal?: TerminalView;
  private selected: Stream | 'terminal';
  private details?: DetailsView;
  private error?: string;
  private busy = false;
  private closed = false;
  private unsubscribe: () => void;
  private ticking?: NodeJS.Timeout;
  private job: JobSummary;
  constructor(private tui: TUI, private theme: Theme, private bindings: KeybindingsManager,
    private options: JobViewOptions, private done: (exit?: TerminalExit) => void) {
    super();
    this.job = options.job;
    this.command = new ScrollView(commandComponent(this.job.command, 'bash', theme));
    // Details/Terminal retain their own renderer and footer budgets. A scoped TUI only
    // changes their available row count; rendering, focus and input still belong to Pi.
    const terminal = new Proxy(tui.terminal, {get: (target, key) => key === 'rows' ? this.bodyRows : Reflect.get(target, key)});
    this.bodyTui = new Proxy(tui, {get: (target, key) => {
      if (key === 'terminal') return terminal;
      if (key === 'mode') return 'fullscreen';
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    }});
    this.selected = options.source ? 'terminal' : this.job.mode === 'pipe' ? 'stdout' : 'output';
    if (options.source) this.terminal = new TerminalView(this.bodyTui, theme, options.source, options.keys, {
      title: () => this.job.name, hideTitle: true, readonly: options.readonly || !options.manager || !options.live,
      canInput: () => this.job.state === 'running',
      takeControl: () => options.manager!.takeControl(this.job.id),
      write: data => { options.manager!.write(this.job.id, data, {source: 'user', kind: 'keys', sensitive: true}); },
      returnControl: () => options.manager?.returnControl(this.job.id),
      userControl: () => options.manager?.userControlled(this.job.id) ?? false,
      navigation: options.navigation, actions: this.actions(), bottom: width => this.bottom(width),
    }, exit => this.finish(exit));
    this.unsubscribe = this.observe();
    if (options.live) { this.ticking = setInterval(() => {
      if (isActive(this.job)) { this.job = options.control.peek(this.job.id); tui.requestRender(); }
    }, 1000); this.ticking.unref(); }
  }
  private observe(): () => void {
    return this.options.live ? this.options.control.subscribe(() => {
      if (this.closed) return;
      this.job = this.options.control.peek(this.job.id); this.tui.requestRender();
    }) : () => {};
  }
  get output(): JobLogView | TerminalView { return this.selected === 'terminal' ? this.terminal! : this.streams.get(this.selected)!; }
  get currentStream(): Stream | 'terminal' { return this.selected; }
  async initialize(): Promise<void> { if (this.selected !== 'terminal') await this.log(this.selected); }
  private async log(stream: Stream): Promise<JobLogView> {
    const existing = this.streams.get(stream);
    if (existing) { existing.activate(); return existing; }
    const view = new JobLogView(this.bodyTui, this.options.control, this.job, stream, this.options.live,
      () => this.finish(), this.theme, {title: false, navigation: this.options.navigation, keys: this.bindings, bottom: width => this.bottom(width)}, this.actions());
    this.streams.set(stream, view); await view.initialize(); return view;
  }
  private actions(): DetailAction[] { return [
    {key: 'd', label: 'Details', run: () => this.showDetails()},
    {key: 'c', label: 'Command', run: () => { this.expanded = !this.expanded; this.commandFocus = false; if (!this.expanded) this.command.offset = 0; }},
    {key: 's', label: 'Switch stream', available: () => !this.busy, run: () => this.perform(() => this.switchStream())},
    {key: 'x', label: 'Stop process and children (keep history)', confirm: true,
      available: () => !this.options.readonly && this.options.live && isActive(this.job) && !this.busy,
      run: () => this.perform(async () => {
        const result = await this.options.control.stop(this.job.id, 'user'); this.job = result.job;
        this.error = ['pending', 'unconfirmed'].includes(result.job.cleanup.state)
          ? `Stop ${result.job.state}; cleanup ${result.job.cleanup.state}${result.job.cleanup.error ? `: ${result.job.cleanup.error}` : ''}`
          : `Stop result: ${result.job.state} · cleanup ${result.job.cleanup.state}`;
      })},
    {key: 'delete', label: 'Delete history, all logs and terminal snapshot', confirm: true,
      available: () => !this.options.readonly && !!this.options.control.clear && !isActive(this.job) && !['pending', 'unconfirmed'].includes(this.job.cleanup.state) && !this.busy,
      run: () => this.perform(async () => {
        // Deletion emits a manager change after removing the identity. Release this
        // object's subscribers first so they cannot peek an identity being cleared.
        this.unsubscribe(); for (const view of this.streams.values()) view.deactivate();
        try { await this.options.control.clear!(this.job.id, this.job.workspace); this.finish(); }
        catch (error) {
          this.unsubscribe = this.observe();
          if (this.output instanceof JobLogView) this.output.activate();
          throw error;
        }
      })},
  ]; }
  private perform(action: () => Promise<void>): void {
    if (this.busy) return;
    this.busy = true; this.error = undefined;
    void action().catch(error => { this.error = error instanceof Error ? error.message : String(error); })
      .finally(() => { this.busy = false; if (!this.closed) this.tui.requestRender(); });
  }
  private async switchStream(): Promise<void> {
    const sources: (Stream | 'terminal')[] = [...this.terminal ? ['terminal' as const] : [], ...streamsOf(this.job)];
    const next = sources[(sources.indexOf(this.selected) + 1) % sources.length];
    if (this.output instanceof JobLogView) this.output.deactivate();
    if (next !== 'terminal') await this.log(next);
    this.selected = next;
  }
  private bottom(width: number): string[] {
    const source = this.options.source;
    const reading = this.selected === 'terminal'
      ? `${source?.viewport?.alternate ? 'alternate screen' : 'terminal screen'} · ${this.terminal?.inputMode ? 'input' : 'read-only'} · ${source?.following !== false ? 'following' : 'history'}`
      : `${this.selected} · ${this.streams.get(this.selected)?.status.split(' · ').slice(-1)[0] ?? 'loading'}${this.job.mode === 'pty' && !source ? ' · log only (no terminal snapshot)' : ''}`;
    return [jobRow(this.job, width, this.theme), truncateToWidth(this.error ? this.theme.fg('warning', this.error)
      : `${this.busy ? 'Working… · ' : ''}${reading}${this.options.readonly || !this.options.live ? ' · read-only object' : ''}${this.commandFocus ? ' · command focus' : ''}`, width)];
  }
  private showDetails(): void {
    this.doubleLeft.reset();
    const text = [`ID: ${this.job.id}`, ...jobDetail(this.job, true),
      ...!this.options.live ? ['history only: not controlled by this Pi process'] : [],
      ...this.job.mode === 'pty' && !this.options.source ? ['log only: no owned terminal or readable final snapshot'] : [],
      'All saved fields:', JSON.stringify(this.job, null, 2)].join('\n');
    this.details = new DetailsView(this.tui, () => 'Job details', new Text(sanitizeText(text), 0, 0), () => {
      this.details?.dispose(); this.details = undefined;
      if (this.options.navigation.closed) this.finish(); this.tui.requestRender();
    }, [], undefined, this.theme, {navigation: this.options.navigation, keys: this.bindings});
  }
  override render(width: number): string[] { return renderLayout(this, width, readingRows(this.tui), () => this.tui.requestRender()).lines; }
  prepareLayout(width: number, total: number): void {
    this.clear();
    if (this.details) { this.details.focused = this.focused; this.addChild(this.details, {basis: 0, grow: 1}); return; }
    this.commandRows = Math.max(1, Math.min(this.expanded ? Math.floor(total * 0.35) : 2, total - 10));
    this.bodyRows = Math.max(1, total - this.commandRows - 2);
    this.output.focused = this.focused && !this.commandFocus;
    this.command.search.focused = this.focused && this.commandFocus && this.command.searching;
    this.addChild(readingText(room => [separator(room, this.theme)]), {basis: 1, shrink: 0});
    this.addChild(this.command.searching ? this.command.search : readingText(room => {
      const heading = this.expanded ? `command ${this.command.position} · Tab focus` : 'command · c expand';
      return [focusLabel(heading, this.commandFocus && this.focused, this.theme)];
    }, true), {basis: 1, shrink: 0});
    this.addChild(new HStack([
      {component: readingText(() => Array.from({length: this.commandRows}, (_, index) => index === 0 ? '$ ' : '  ')), basis: 2, shrink: 0},
      {component: this.command, basis: 0, grow: 1},
    ]), {basis: this.commandRows, shrink: 0});
    // Text logs remain actual ScrollView descendants. PTY keeps its own two-dimensional
    // screen component and process-size management, constrained only by the body budget.
    this.addChild(this.output, {basis: 0, grow: 1, minSize: 1});
  }
  handleInput(data: string): void {
    if (this.details) { this.details.handleInput(data); return; }
    if (this.terminal?.inputMode && this.selected === 'terminal') { this.terminal.handleInput(data); return; }
    if (this.commandFocus && this.command.searching) {
      this.doubleLeft.reset(); this.command.handleInput(data); this.tui.requestRender(); return;
    }
    if (this.output instanceof JobLogView && this.output.reader.searching) { this.output.handleInput(data); return; }
    if (matchesKey(data, Key.tab)) {
      // The child owns action confirmation and its pending Left; changing focus must
      // cancel both rather than letting a later press complete an old destructive key.
      this.output.handleInput(data);
      this.doubleLeft.reset(); this.commandFocus = !this.commandFocus;
      if (this.commandFocus) this.expanded = true; this.tui.requestRender(); return;
    }
    if (this.commandFocus) {
      if (this.doubleLeft.handle(data)) { this.options.navigation.close(); this.finish(); }
      else if (matchesKey(data, Key.escape)) { this.commandFocus = false; }
      else if (data === 'd') this.showDetails();
      else if (data === 'c') { this.expanded = false; this.commandFocus = false; this.command.offset = 0; }
      else this.command.handleInput(data);
      this.tui.requestRender(); return;
    }
    this.output.handleInput(data);
  }
  handleMouseCapture(event: TuiMouseEvent) {
    if (this.details) return undefined;
    this.doubleLeft.reset();
    if (this.selected === 'terminal' && this.terminal?.inputMode) return event.y < this.commandRows + 2 ? {handled: true} : undefined;
    if (event.type !== 'wheel' && !(event.button === 'left' && (event.type === 'press' || event.type === 'click'))) return undefined;
    if (event.y < this.commandRows + 2) {
      if (this.output instanceof JobLogView && this.output.textInputActive) return {handled: true};
      if (event.type !== 'wheel') {
        this.output.handleInput('\t'); this.commandFocus = true; this.expanded = true; this.tui.requestRender();
        if (event.y < 2) return {handled: true};
      }
    } else if (event.type !== 'wheel') { this.commandFocus = false; this.tui.requestRender(); }
    return undefined;
  }
  override invalidate(): void { this.command.invalidate(); this.details?.invalidate(); this.terminal?.invalidate(); for (const view of this.streams.values()) view.invalidate(); }
  private finish(exit?: TerminalExit): void { if (this.closed) return; this.closed = true; this.dispose(); this.done(exit); }
  dispose(): void {
    this.closed = true; this.doubleLeft.reset(); this.command.dispose(); clearInterval(this.ticking); this.unsubscribe();
    this.details?.dispose(); this.terminal?.dispose(); for (const view of this.streams.values()) view.dispose();
  }
}
