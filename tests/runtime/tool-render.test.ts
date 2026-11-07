import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Theme, ToolRenderers } from '@earendil-works/pi-coding-agent';
import { visibleWidth } from '@earendil-works/pi-tui';
import { toolRenderers } from '../../src/ui/tool-render.ts';

test('shared tool shell merges progress/results, pads one-line summaries and retains full expanded/error output', () => {
  const theme = { fg: (_tone: string, text: string) => `\x1b[31m${text}\x1b[39m` } as Theme;
  const renderer = toolRenderers<unknown, { summary: string }>({
    call: () => ({ icon: '⟳', tone: 'accent', title: 'Call' }),
    collapsed: data => ({ icon: '✔', tone: 'success', title: 'Result\nheading', summary: data.summary, meta: ['meta\nline'] }),
  });
  const ctx = { state: {}, args: {}, isError: false, outputPad: 2 } as Parameters<NonNullable<ToolRenderers['renderResult']>>[3];
  const call = renderer.renderCall!({}, theme, ctx);
  assert.equal(call.render(40).length, 1);
  const body = Array.from({length: 20}, (_, i) => `body ${i}`).join('\n');
  const result = { content: [{type: 'text' as const, text: body}], details: { summary: 'a\nb'.repeat(100) } };
  for (const isPartial of [true, false]) {
    const component = renderer.renderResult!(result, { expanded: false, isPartial }, theme, ctx);
    assert.deepEqual(call.render(40), []);
    for (const width of [40, 60, 120]) {
      const lines = component.render(width);
      assert.equal(lines.length, 1); assert.ok(visibleWidth(lines[0]) <= width);
      assert.ok(lines[0].startsWith('  '));
    }
  }
  assert.match(renderer.renderResult!(result, {expanded: true, isPartial: false}, theme, ctx).render(40).join('\n'), /body 19/);
  ctx.isError = true;
  const error = renderer.renderResult!(result, {expanded: false, isPartial: false}, theme, ctx).render(40).join('\n');
  assert.match(error, /✘/); assert.match(error, /body 19/);
});
