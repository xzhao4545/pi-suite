import type { AskResult } from "./schema.ts";

interface Entry {
  show: () => Promise<AskResult>; signal?: AbortSignal;
  resolve: (result: AskResult) => void; reject: (error: unknown) => void;
}
export const cancelled = (): AskResult => ({ status: "cancelled", responses: [] });

/** Only displayed prompts own a deadline. An aborted queued prompt never opens a view. */
export class AskQueue {
  private entries: Entry[] = [];
  private running = false;
  enqueue(show: Entry["show"], signal?: AbortSignal): Promise<AskResult> {
    if (signal?.aborted) return Promise.resolve(cancelled());
    return new Promise((resolve, reject) => {
      const entry: Entry = { show, signal, resolve, reject };
      const abort = () => {
        const index = this.entries.indexOf(entry);
        if (index >= 0) { this.entries.splice(index, 1); resolve(cancelled()); }
      };
      signal?.addEventListener("abort", abort, { once: true });
      const removeListener = () => signal?.removeEventListener("abort", abort);
      entry.resolve = result => { removeListener(); resolve(result); };
      entry.reject = error => { removeListener(); reject(error); };
      this.entries.push(entry);
      void this.drain();
    });
  }
  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.entries.length) {
        const entry = this.entries.shift()!;
        try { entry.resolve(entry.signal?.aborted ? cancelled() : await entry.show()); }
        catch (error) { entry.reject(error); }
      }
    } finally { this.running = false; }
  }
}
