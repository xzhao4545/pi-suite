import { getSelectListTheme, type Theme } from '@earendil-works/pi-coding-agent';
import { Editor, Input, Key, getKeybindings, matchesKey, truncateToWidth, visibleWidth, type TUI, type TuiMouseEvent } from '@earendil-works/pi-tui';
import { sanitizeText } from '../runtime/text.ts';
import { feedback, focusLabel, keyHint } from './browser-chrome.ts';
import { ViewerEditor } from './viewer/editor.ts';

export interface InlineRequest { prompt: string; submit: (message: string) => Promise<string>; multiline?: boolean }
/** One composer owns editing and the in-flight draft for both browser and reading frames. */
export class InlineInput {
  private input?: Input | ViewerEditor;
  private request?: InlineRequest;
  private sending = false;
  private hidden = false;
  private notice?: {text: string; error: boolean};
  private disposed = false;
  private editorRows = 0;
  constructor(private refresh: () => void, private theme?: Theme, private tui?: TUI, private keys = getKeybindings()) {}
  get active(): boolean { return !this.hidden && (Boolean(this.input) || this.sending); }
  get multiline(): boolean { return this.input instanceof Editor; }
  set focused(value: boolean) { if (this.input) this.input.focused = value && !this.sending; }
  open(request: InlineRequest): void {
    this.hidden = false;
    // Reopening during an already submitted request only shows that request; it cannot send twice.
    if (this.sending) { this.refresh(); return; }
    this.notice = undefined; this.request = request;
    if (request.multiline) {
      const editor = new ViewerEditor(this.tui!, {borderColor: text => this.theme?.fg(this.input?.focused ? 'accent' : 'borderMuted', text) ?? text, selectList: getSelectListTheme()});
      editor.disableSubmit = true;
      this.input = editor;
    } else {
      const input = new Input({prompt: sanitizeText(request.prompt).replace(/[\r\n\t]/g, ' ')});
      input.onSubmit = value => this.submit(value);
      this.input = input;
    }
    this.input.focused = true; this.refresh();
  }
  private submit(value: string): void {
    const message = this.request?.multiline ? value : value.trim();
    if (!message.trim()) { this.input = undefined; this.refresh(); return; }
    this.sending = true; this.focused = false;
    // Keep the native editor, its cursor and undo stack until success. A rejected run/IO
    // request is a user-visible retry path, not permission to silently discard the draft.
    void this.request!.submit(message).then(text => {
      this.input = undefined; this.notice = {text, error: false};
    }, error => {
      this.notice = {text: error instanceof Error ? error.message : String(error), error: true};
    }).finally(() => {
      this.sending = false; this.focused = true;
      if (!this.disposed) this.refresh();
    });
    this.refresh();
  }
  handleInput(data: string): boolean {
    this.notice = undefined;
    if (!this.active) return false;
    if (matchesKey(data, Key.escape)) {
      this.hidden = true; this.input = undefined;
    } else if (!this.sending && this.input instanceof Editor) {
      if (this.keys.matches(data, 'tui.input.newLine')) this.input.insertTextAtCursor('\n');
      else if (this.keys.matches(data, 'tui.input.submit')) this.submit(this.input.getExpandedText());
      else this.input.handleInput(data);
    } else if (!this.sending) this.input?.handleInput(data);
    this.refresh(); return true;
  }
  renderRows(width: number, maxRows: number): string[] {
    if (this.input instanceof ViewerEditor) {
      const prompt = truncateToWidth(`${focusLabel('Input', Boolean(this.input.focused), this.theme)} ${sanitizeText(this.request!.prompt).replace(/[\r\n\t]/g, ' ')}`, width);
      const rows = maxRows > 1 ? [prompt, ...this.input.renderWithin(width, maxRows - 1)] : this.input.renderWithin(width, 1);
      this.editorRows = rows.length;
      return rows;
    }
    return [this.render(width) ?? ''];
  }
  render(width: number): string | undefined {
    if (this.input instanceof Input) return this.input.render(width)[0] ?? '';
    const notice = this.sending ? {text: 'Sending…', error: false} : this.notice;
    return notice && truncateToWidth(feedback(sanitizeText(notice.text).replace(/[\r\n\t]/g, ' '), notice.error, this.theme), width);
  }
  handleMouse(event: TuiMouseEvent): void {
    if (this.sending) return;
    if (this.input instanceof ViewerEditor) {
      const promptRows = Number(this.editorRows > 1);
      if (event.y < promptRows || event.y >= this.editorRows) return;
      this.input.handleMouse({...event, y: event.y - promptRows + this.input.viewportStart});
    } else if (this.input) {
      // Native Input's mouse offset is two columns even with a custom prompt.
      const prompt = sanitizeText(this.request!.prompt).replace(/[\r\n\t]/g, ' ');
      this.input.handleMouse({...event, x: event.x - visibleWidth(prompt) + 2});
    }
  }
  help(): string {
    const keys = (action: Parameters<typeof this.keys.getKeys>[0]) => this.keys.getKeys(action).join('/');
    const help = [!this.sending ? keyHint(keys('tui.input.submit'), 'send', this.theme) : 'Sending…',
      ...this.multiline ? [keyHint(keys('tui.input.newLine'), 'newline', this.theme)] : [], keyHint('Esc', 'cancel', this.theme)].join(' · ');
    return this.notice?.error ? `${feedback(sanitizeText(this.notice.text).replace(/[\r\n\t]/g, ' '), true, this.theme)} · ${help}` : help;
  }
  dispose(): void { this.disposed = true; }
}
