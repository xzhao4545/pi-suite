import {test} from 'node:test';
import assert from 'node:assert/strict';
import {type Theme} from '@earendil-works/pi-coding-agent';
import {VStack, visibleWidth} from '@earendil-works/pi-tui';
import {AskView} from '../../src/ask/view.ts';
import {AskForm} from '../../src/ask/form.ts';
import {normalize} from '../../src/ask/schema.ts';
import {defaults} from '../../src/runtime/config.ts';
import {Dock} from '../../src/ui/dock.ts';
import {Transcript} from '../../src/ui/transcript.ts';
import {readerTerminal} from '../support/reader.ts';

test('fullscreen inline Ask History uses the shared keyboard window without changing its native draft or answer state', async () => {
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
    native.send('\x1b[B'); assert.match((await native.lines())[0], /history 2\//);
    native.send('/'); native.send('HISTORY END'); native.send('\r');
    assert.match((await native.lines()).join('\n'), /HISTORY END/);
    native.send('\x1b[F'); assert.match((await native.lines()).join('\n'), /HISTORY END/);
    for (const [rows, columns] of [[24, 40], [30, 80], [40, 120]]) {
      native.resize(rows, columns);
      const rendered = view.render(columns);
      assert.ok(rendered.length <= rows); assert.ok(rendered.every(line => visibleWidth(line) <= columns));
      assert.equal(form.draft.text, 'draft branch'); assert.equal(submitted, false);
    }
    native.send('\x08'); assert.equal(form.draft.text, 'draft branch'); assert.equal(submitted, false);
    assert.doesNotMatch(view.render(120)[0], /^history /);
  } finally {view.dispose(); native.dispose();}
});
