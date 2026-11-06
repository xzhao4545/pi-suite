import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentSessionRuntime, InteractiveMode, type CustomEditor } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage, fauxThinking, fauxText } from '@earendil-works/pi-ai';
import type { TUI } from '@earendil-works/pi-tui';
import { host } from '../support/host.ts';
import { terminal } from '../support/terminal.ts';

// Exercise Pi 1.5's actual key/abort wiring. Only initialization (tool downloads
// and theme watchers) is omitted; the focused editor and terminal dispatcher are native.
test('native regular/fullscreen Esc stops text and thinking streams, aborts the provider and freezes goal continuation', {timeout: 15000}, async () => {
  for (const tuiMode of ['regular', 'fullscreen'] as const) for (const kind of ['text', 'thinking'] as const) {
    const h = await host({streaming: {tokensPerSecond: 300, tokenSize: {min: 20, max: 20}}});
    const runtime = new AgentSessionRuntime(h.session, h.services, async () => { throw new Error('Unexpected session replacement'); });
    const device = terminal(40, 120).terminal;
    let key!: (data: string) => void, providerSignal: AbortSignal | undefined, deltas = 0;
    device.start = onInput => { key = onInput; };
    const mode = new InteractiveMode(runtime, {terminal: device, tuiMode}) as unknown as {
      ui: TUI; defaultEditor: CustomEditor; setupKeyHandlers(): void; bindCurrentSessionExtensions(): Promise<void>;
      footerDataProvider: {dispose(): void};
    };
    const entered = Promise.withResolvers<void>();
    const off = h.session.subscribe(event => {
      if (event.type === 'message_update' && (event.assistantMessageEvent.type === 'text_delta' || event.assistantMessageEvent.type === 'thinking_delta')) {
        deltas++; entered.resolve();
      }
    });
    try {
      mode.setupKeyHandlers();
      mode.ui.addChild(mode.defaultEditor); mode.ui.setFocus(mode.defaultEditor); mode.ui.start();
      await mode.bindCurrentSessionExtensions();
      h.faux.setResponses([(_context, options) => {
        providerSignal = options?.signal;
        return fauxAssistantMessage(kind === 'text' ? fauxText('STREAM_BODY '.repeat(200)) : fauxThinking('STREAM_THINKING '.repeat(200)));
      }]);
      const running = h.session.prompt('/goal Verify keyboard interruption');
      await entered.promise;
      assert.equal(h.session.isStreaming, true);
      const before = deltas;
      key('\x1b');
      await running; await h.idle();
      assert.equal(providerSignal?.aborted, true, `${tuiMode}/${kind}: provider receives abort`);
      assert.equal(deltas, before, 'no further body/thinking deltas after Escape');
      assert.equal(h.goal()?.automatic, false); assert.equal(h.faux.state.callCount, 1);
      assert.equal(h.session.messages.findLast(message => message.role === 'assistant')?.stopReason, 'aborted');
    } finally { off(); mode.ui.stop(); mode.footerDataProvider.dispose(); await h.dispose(); }
  }
});
