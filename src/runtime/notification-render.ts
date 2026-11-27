import type { MessageRenderer } from '@earendil-works/pi-coding-agent';
import { Box, Container, Text } from '@earendil-works/pi-tui';
import { stateLine, toolLine, type ToolLine } from '../ui/tool-render.ts';
import type { NotificationDetails } from './notifications.ts';
import { sanitizeText } from './text.ts';

export const notificationRenderer: MessageRenderer<NotificationDetails> = (message, { expanded, outputPad }, theme) => {
  const { details, content } = message;
  // Quiet job notices retain their original string content; queued notices use text blocks.
  const blocks = typeof content === 'string' ? [{ type: 'text' as const, text: content }] : content;
  if (details?.notificationVersion !== 1 || details.segments?.length !== blocks.length) return;
  const visible = blocks.flatMap((block, index) => {
    const segment = details.segments[index];
    return segment.source === 'goal-continuation' ? [] : [{ block, view: segment.view }];
  });
  // Only presentation is filtered. Leave image events to Pi instead of dropping their images here.
  if (visible.some(({ block }) => block.type !== 'text')) return;
  if (!visible.length) return new Container();
  if (!visible.some(({ view }) => view)) {
    return new Text(sanitizeText(visible.map(({ block }) => block.type === 'text' ? block.text : '').join('\n')), outputPad, 0);
  }
  const body = new Box(outputPad, 0);
  for (const { block, view } of visible) {
    if (!view) {
      if (block.type === 'text') body.addChild(new Text(sanitizeText(block.text), 0, 0));
      continue;
    }
    const line: ToolLine = { icon: '', title: view.title, meta: [
      ...view.state ? [{ text: view.state, tone: stateLine(view.state).tone ?? 'accent' }] : [], ...view.meta ?? [],
    ] };
    body.addChild({ render: width => [toolLine(theme, line, width)], invalidate() {} });
    if (expanded && view.body) body.addChild(new Text(sanitizeText(view.body), 0, 0));
  }
  return body;
};
