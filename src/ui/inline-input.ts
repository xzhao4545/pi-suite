import type { Theme } from '@earendil-works/pi-coding-agent';
import { Input, Key, matchesKey, truncateToWidth } from '@earendil-works/pi-tui';
import { sanitizeText } from '../runtime/text.ts';
import { feedback, keyHint } from './browser-chrome.ts';

export interface InlineRequest { prompt: string; submit: (message: string) => Promise<string> }
/** One composer for every frame; its input owns all keys until submit/cancel completes. */
export class InlineInput {
  private input?: Input;
  private sending = false;
  private notice?: {text: string; error: boolean};
  private disposed = false;
  constructor(private refresh: () => void, private theme?: Theme) {}
  get active(): boolean { return Boolean(this.input) || this.sending; }
  open(request: InlineRequest): void {
    this.notice = undefined;
    const input = this.input = new Input({prompt: sanitizeText(request.prompt).replace(/[\r\n\t]/g, ' ')});
    input.focused = true;
    input.onSubmit = value => {
      const message = value.trim();
      this.input = undefined;
      if (message) {
        this.sending = true;
        // This is the UI's asynchronous error boundary: report in the same frame, not the parent.
        void request.submit(message).then(text => {this.notice = {text, error: false};}, error => {
          this.notice = {text: error instanceof Error ? error.message : String(error), error: true};
        }).finally(() => {this.sending = false; if (!this.disposed) this.refresh();});
      }
      this.refresh();
    };
    this.refresh();
  }
  handleInput(data: string): boolean {
    this.notice = undefined;
    if (!this.active) return false;
    if (this.input) {
      if (matchesKey(data, Key.escape)) this.input = undefined;
      else this.input.handleInput(data);
    }
    this.refresh(); return true;
  }
  render(width: number): string | undefined {
    if (this.input) return this.input.render(width)[0] ?? '';
    const notice = this.sending ? {text: 'Sending…', error: false} : this.notice;
    return notice && truncateToWidth(feedback(sanitizeText(notice.text).replace(/[\r\n\t]/g, ' '), notice.error, this.theme), width);
  }
  help(): string { return [keyHint('Enter', 'send', this.theme), keyHint('Esc', 'cancel', this.theme)].join(' · '); }
  dispose(): void { this.disposed = true; }
}
