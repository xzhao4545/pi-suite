import {test} from 'node:test';
import assert from 'node:assert/strict';
import {type Theme} from '@earendil-works/pi-coding-agent';
import {VStack, renderLayout, getScrollViewBox, getScrollbarGeometry} from '@earendil-works/pi-tui';
import {AskView} from '../../src/ask/view.ts';
import {AskForm} from '../../src/ask/form.ts';
import {normalize} from '../../src/ask/schema.ts';
import {defaults} from '../../src/runtime/config.ts';
import {Dock} from '../../src/ui/dock.ts';
import {Transcript} from '../../src/ui/transcript.ts';
import {readerTerminal} from '../support/reader.ts';

test('fullscreen inline Ask History exposes its native scroll node without changing the draft or answer state', async () => {
  const native = readerTerminal(30, 80);
  const theme = globalThis[Symbol.for('@earendil-works/pi-coding-agent:theme') as unknown as keyof typeof globalThis] as unknown as Theme;
  const transcript = new Transcript(native.tui, process.cwd());
  transcript.setEntries([{type: 'message', id: 'history', parentId: null, timestamp: new Date().toISOString(),
    message: {role: 'user', content: 'history 中文\n'.repeat(80) + 'HISTORY END', timestamp: Date.now()}}]);
  const form = new AskForm(normalize({question: 'Branch?', defaultAnswer: 'draft branch', timeoutMs: 0}));
  let submitted = false;
  const view = new AskView(form, native.tui, theme, new Dock(), defaults, transcript, () => {submitted = true;}, 0);
  native.tui.setLayoutRoot(new VStack([{component: view, basis: 0, grow: 1}])); native.tui.setFocus(view);
  try {
    native.tui.renderNow(); native.send('\x08');
    const frame = renderLayout(view, 80, 30, () => native.tui.requestRender());
    assert.ok(frame.primaryScrollView);
    const scroll = frame.primaryScrollView, box = getScrollViewBox(frame, scroll)!;
    const geometry = getScrollbarGeometry(box, true)!;
    native.send(`\x1b[<65;2;${box.rect.y + 2}M`); assert.ok(scroll.scrollTop > 0);
    native.send(`\x1b[<35;${geometry.column + 1};${geometry.trackTop + 1}M`);
    assert.ok((await native.lines()).some(line => line.endsWith('█')));
    native.send('\x1b[F'); assert.match((await native.lines()).join('\n'), /HISTORY END/);
    assert.equal(form.draft.text, 'draft branch'); assert.equal(submitted, false);
    native.send('\x08'); assert.equal(form.draft.text, 'draft branch'); assert.equal(submitted, false);
    assert.equal(renderLayout(view, 80, 30, () => native.tui.requestRender()).primaryScrollView, undefined);
  } finally {view.dispose(); native.dispose();}
});
