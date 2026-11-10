import { test } from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import type { SessionEntry, ToolRenderers } from '@earendil-works/pi-coding-agent';
import { Text, VStack, renderLayout, getScrollViewBox, getScrollbarGeometry } from '@earendil-works/pi-tui';
import { DetailsView } from '../../src/ui/details.ts';
import { Transcript } from '../../src/ui/transcript.ts';
import { readerTerminal } from '../support/reader.ts';

const stamp = new Date().toISOString();
const user = (id: string, text: string): SessionEntry => ({type: 'message', id, parentId: null, timestamp: stamp,
  message: {role: 'user', content: text, timestamp: Date.now()}});
const result = (id: string): SessionEntry => ({type: 'message', id: `result:${id}`, parentId: 'calls', timestamp: stamp,
  message: {role: 'toolResult', toolCallId: id, toolName: 'fixture', content: [{type: 'text', text: id}], isError: false, timestamp: Date.now()}});

test('actual Pi overlay renders nested transcript tools, dispatches scrolled clicks and native scrollbar drag through resize, then restores focus', async () => {
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
  const view = new DetailsView(tui, () => 'Native transcript', transcript, () => {handle.hide(); view.dispose();});
  view.reader.follow();
  handle = tui.showOverlay(view, {row: 0, col: 0, width: '100%', maxHeight: '100%'});
  const click = (x: number, y: number) => {native.send(`\x1b[<0;${x + 1};${y + 1}M`); native.send(`\x1b[<0;${x + 1};${y + 1}m`);};
  const seek = async (id: string) => {
    native.send('/'); native.send(`result ${id}`); native.send('\r');
    const lines = await native.lines(), row = lines.findIndex(line => line.includes(`result ${id}`));
    assert.ok(row >= 0); assert.ok(view.reader.offset > 0); assert.equal(view.reader.following, false);
    return row;
  };
  try {
    tui.renderNow(); assert.match((await native.lines()).join('\n'), /END MARKER/);
    const row = await seek('one'), offset = view.reader.offset;
    click(2, row); assert.equal(renders.at(-1), 'one:true');
    assert.equal(view.reader.offset, offset); assert.equal(view.reader.following, false); assert.equal(view.reader.hasNewOutput, false);
    const oneState = states.get('one'), twoState = states.get('two');
    for (const [rows, width] of [[24, 40], [30, 80], [40, 120]]) {
      native.resize(rows, width);
      assert.equal(states.get('one'), oneState); assert.equal(states.get('two'), twoState);
      assert.equal(view.reader.following, false); assert.equal(view.reader.query, 'result one');
      assert.match((await native.lines()).join('\n'), /one 中文 line/);
      const frame = renderLayout(view, width, rows, () => tui.requestRender());
      const box = getScrollViewBox(frame, view.reader)!;
      assert.ok(box); assert.ok(box.rect.height < rows, 'footer is outside the native viewport');
    }
    click(2, await seek('two')); assert.equal(renders.at(-1), 'two:true');
    click(2, await seek('one')); assert.equal(renders.at(-1), 'one:false');
    assert.equal(view.reader.hasNewOutput, false, 'expansion is layout, not provider output');
    // Hover reveals auto scrollbar at its actual native column; drag/track use Pi's geometry.
    tui.renderNow();
    let frame = renderLayout(view, 120, 40, () => tui.requestRender());
    let geometry = getScrollbarGeometry(getScrollViewBox(frame, view.reader)!, true)!;
    native.send(`\x1b[<35;${geometry.column + 1};${geometry.thumbTop + 1}M`);
    assert.match((await native.lines())[geometry.thumbTop], /█/);
    const beforeDrag = view.reader.offset;
    native.send(`\x1b[<0;${geometry.column + 1};${geometry.thumbTop + 1}M`);
    native.send(`\x1b[<32;${geometry.column + 1};${geometry.trackTop + geometry.trackHeight}M`);
    native.send(`\x1b[<0;${geometry.column + 1};${geometry.trackTop + geometry.trackHeight}m`);
    assert.ok(view.reader.offset > beforeDrag); assert.equal(view.reader.following, true);
    assert.match((await native.lines()).join('\n'), /END MARKER/);
    frame = renderLayout(view, 120, 40, () => tui.requestRender());
    geometry = getScrollbarGeometry(getScrollViewBox(frame, view.reader)!, true)!;
    click(geometry.column, geometry.trackTop); assert.equal(view.reader.following, false);
    assert.ok(native.writes.join('').includes('█'), 'scrollbar was painted by the actual TUI');
    native.send('\x1b[<35;1;1M'); // Leaving the track arms Pi's native auto-hide timer.
    await sleep(1050);
    assert.equal(view.reader.isScrollbarVisible, false);
    assert.ok((await native.lines()).every(line => !/[█┃]$/.test(line)), 'the injected render request repaints auto-hide');
    transcript.setEntries([user('short', 'short content')]); tui.renderNow();
    assert.equal(view.reader.offset, 0); assert.equal(view.reader.following, false, 'layout clamp cannot resume a paused reader');
    native.send('\x1b[F'); assert.equal(view.reader.following, true, 'End is explicit navigation even for short content');
    native.send('\x1b'); assert.equal(tui.hasOverlay(), false);
    // A normal viewport key now targets the base, proving overlay input ownership was released.
    assert.equal((tui as unknown as {getFocusedComponent(): unknown}).getFocusedComponent(), base);
  } finally {handle.hide(); view.dispose(); native.dispose();}
});
