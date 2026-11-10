import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import type { SessionEntry, ToolRenderers } from '@earendil-works/pi-coding-agent';
import { Text, VStack, visibleWidth } from '@earendil-works/pi-tui';
import { DetailsView } from '../../src/ui/details.ts';
import { Transcript } from '../../src/ui/transcript.ts';
import { readerTerminal } from '../support/reader.ts';

const stamp = new Date().toISOString();
const user = (id: string, text: string): SessionEntry => ({type: 'message', id, parentId: null, timestamp: stamp,
  message: {role: 'user', content: text, timestamp: Date.now()}});
const result = (id: string): SessionEntry => ({type: 'message', id: `result:${id}`, parentId: 'calls', timestamp: stamp,
  message: {role: 'toolResult', toolCallId: id, toolName: 'fixture', content: [{type: 'text', text: id}], isError: false, timestamp: Date.now()}});

test('actual Pi overlay reads native transcript tools by keyboard through search, expansion and resize, then restores focus', async () => {
  const native = readerTerminal(), tui = native.tui;
  const base = new Text('Base editor', 0, 0); tui.setLayoutRoot(new VStack([base])); tui.setFocus(base);
  const states = new Map<string, unknown>(), renders: string[] = [];
  const renderer: ToolRenderers = {
    renderCall: (_args, _theme, ctx) => { states.set(ctx.toolCallId, ctx.state); return new Text(`call ${ctx.toolCallId}`, 0, 0); },
    renderResult: (_result, options, _theme, ctx) => {
      renders.push(`${ctx.toolCallId}:${options.expanded}`);
      return new Text(`result ${ctx.toolCallId}\n` + Array.from({length: options.expanded ? 12 : 1}, (_, i) => `${ctx.toolCallId} 中文 line ${i}`).join('\n'), 0, 0);
    },
  };
  const transcript = new Transcript(tui, process.cwd(), () => renderer);
  const entries: SessionEntry[] = [user('before', 'leading 中文\n'.repeat(50)),
    {type: 'message', id: 'calls', parentId: null, timestamp: stamp, message: fauxAssistantMessage([
      fauxToolCall('fixture', {}, {id: 'one'}), fauxToolCall('fixture', {}, {id: 'two'}),
    ])}, result('one'), result('two'), user('after', 'trailing\n'.repeat(50) + 'END MARKER')];
  transcript.setEntries(entries);
  let handle: ReturnType<typeof tui.showOverlay>;
  const view = new DetailsView(tui, () => 'Transcript', transcript, () => {handle.hide(); view.dispose();},
    [{key: 'o', label: 'Tools', run: () => transcript.toggleTools()}]);
  view.reader.follow();
  handle = tui.showOverlay(view, {row: 0, col: 0, width: '100%', maxHeight: '100%'});
  const seek = async (id: string) => {
    native.send('/'); native.send(`result ${id}`); native.send('\r');
    assert.match((await native.lines()).join('\n'), new RegExp(`result ${id}`));
    assert.ok(view.reader.offset > 0); assert.equal(view.reader.following, false);
  };
  try {
    tui.renderNow(); assert.match((await native.lines()).join('\n'), /END MARKER/);
    await seek('one'); const offset = view.reader.offset;
    native.send('o'); assert.ok(renders.includes('one:true')); assert.ok(renders.includes('two:true'));
    assert.equal(view.reader.offset, offset); assert.equal(view.reader.following, false); assert.equal(view.reader.hasNewOutput, false);
    const oneState = states.get('one'), twoState = states.get('two');
    for (const [rows, width] of [[24, 40], [30, 80], [40, 120]]) {
      native.resize(rows, width);
      assert.equal(states.get('one'), oneState); assert.equal(states.get('two'), twoState);
      assert.equal(view.reader.following, false); assert.equal(view.reader.query, 'result one');
      assert.match((await native.lines()).join('\n'), /one 中文 line/);
      assert.ok(view.reader.viewportHeight < rows, 'footer is outside the reader budget');
      const lines = view.render(width); assert.equal(lines.length, rows); assert.ok(lines.every(line => visibleWidth(line) <= width));
    }
    await seek('two'); native.send('o'); assert.ok(renders.includes('one:false')); assert.ok(renders.includes('two:false'));
    assert.equal(view.reader.hasNewOutput, false, 'expansion is layout, not provider output');
    native.send('\x1b[H'); assert.equal(view.reader.offset, 0); assert.equal(view.reader.following, false);
    native.send('\x1b[6~'); assert.ok(view.reader.offset > 0);
    native.send('\x1b[F'); assert.equal(view.reader.following, true);
    assert.match((await native.lines()).join('\n'), /END MARKER/);
    view.reader.pause(); transcript.setEntries([user('short', 'short content')]); tui.renderNow();
    assert.equal(view.reader.offset, 0); assert.equal(view.reader.following, false, 'layout clamp cannot resume a paused reader');
    assert.equal(view.reader.scrollbar, 'hidden', 'U1 does not simulate overlay scrollbars');
    native.send('\x1b[F'); assert.equal(view.reader.following, true, 'End is explicit navigation even for short content');
    native.send('\x1b'); assert.equal(tui.hasOverlay(), false);
    assert.equal((tui as unknown as {getFocusedComponent(): unknown}).getFocusedComponent(), base);
  } finally {handle.hide(); view.dispose(); native.dispose();}
});
