import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MessageRenderOptions, Theme } from '@earendil-works/pi-coding-agent';
import { notificationRenderer } from '../../src/runtime/notification-render.ts';

const theme = { fg: (_tone: string, text: string) => text } as Theme;
const options = (expanded: boolean): MessageRenderOptions => ({ expanded, outputPad: 2, keyText: () => '', keyHint: () => '' });
type Message = Parameters<typeof notificationRenderer>[0];
function lines(message: Message, expanded: boolean, width = 80): string[] {
  return notificationRenderer(message, options(expanded), theme)!.render(width).map(line => line.trimEnd());
}

test('notification captions stay on one line per visible segment and expansion shows their bodies', () => {
  const message: Message = {
    role: 'custom', customType: 'pi-suite:notification', display: true, timestamp: 0,
    content: ['job payload', 'control', 'agent payload'].map(text => ({ type: 'text', text })),
    details: { notificationVersion: 1, segments: [
      { requestId: 'job:1', source: 'event', view: { title: 'Job result', state: 'completed', meta: ['job_3fa1c2d0'], body: 'first\nsecond' } },
      { requestId: 'goal:1', source: 'goal-continuation' },
      { requestId: 'agent:1', source: 'event', view: { title: 'Agent result', state: 'failed', body: 'diagnostic' } },
    ] },
  };
  const job = '  Job result · completed · job_3fa1c2d0', agent = '  Agent result · failed';
  assert.deepEqual(lines(message, false), [job, agent]);
  assert.equal(lines(message, false, 18).length, 2);
  assert.deepEqual(lines(message, true), [job, '  first', '  second', agent, '  diagnostic']);
});

test('a notification from history without a view still displays its text', () => {
  const message: Message = {
    role: 'custom', customType: 'pi-suite:notification', display: true, timestamp: 0,
    content: [{ type: 'text', text: 'old\nnotification' }],
    details: { notificationVersion: 1, segments: [{ requestId: 'job:1', source: 'event' }] },
  };
  for (const expanded of [false, true]) assert.deepEqual(lines(message, expanded), ['  old', '  notification']);
});
