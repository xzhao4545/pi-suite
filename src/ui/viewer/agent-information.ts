import type { Theme } from '@earendil-works/pi-coding-agent';
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { sanitizeText } from '../../runtime/text.ts';
import type { AgentRecord } from '../../agents/types.ts';
import type { ScrollView } from '../scroll.ts';
import { newOutputHint, stateTone } from '../browser-chrome.ts';
import { countText, elapsedText } from '../format.ts';

const literal = (text: string) => sanitizeText(text).replace(/[\r\n\t]/g, ' ');

/** Names/state/runtime survive narrow layouts before optional model/usage fields. */
export function agentInformation(record: AgentRecord, waiting: boolean, readonly: boolean, reader: ScrollView, width: number, theme: Theme): string[] {
  const state = waiting ? 'waiting(parent)' : record.state;
  const status = theme.fg(stateTone(state) ?? 'text', state);
  const time = theme.fg('muted', record.elapsedMs === undefined ? 'not started' : elapsedText(record.elapsedMs));
  const tokens = record.usage ? theme.fg('muted', `↑${countText(record.usage.tokens.input)} ↓${countText(record.usage.tokens.output)}`) : '';
  let tail = `${status} · ${time}${tokens ? ` · ${tokens}` : ''}${readonly ? theme.fg('muted', ' · read only') : ''}`;
  if (visibleWidth(tail) + 12 > width) tail = `${status} · ${time}`;
  if (visibleWidth(tail) + 8 > width) tail = status;
  const name = theme.bold(truncateToWidth(literal(record.name), Math.max(1, width - visibleWidth(tail) - 3)));
  const first = truncateToWidth(`${name} · ${tail}`, width);
  const position = theme.fg('muted', `${reader.position} · ${reader.following ? 'following' : 'paused'}`)
    + (reader.hasNewOutput ? ` · ${newOutputHint(theme, width < 80)}` : '');
  const tools = record.toolUses === undefined ? '' : theme.fg('muted', ` · ${record.toolUses} tools`);
  const thinking = `${theme.fg('muted', 'thinking')} ${record.thinking}`;
  const model = literal(record.model);
  const room = Math.max(0, width - visibleWidth(position) - 3);
  let settings = `${theme.fg('accent', model)} · ${thinking}${tools}`;
  if (visibleWidth(settings) > room) settings = `${theme.fg('accent', truncateToWidth(model, Math.max(0, room - visibleWidth(thinking) - 3)))} · ${thinking}`;
  if (visibleWidth(settings) > room) settings = theme.fg('accent', truncateToWidth(model, room));
  const second = truncateToWidth(`${settings}${visibleWidth(settings) ? ' · ' : ''}${position}`, width);
  const combined = `${first} · ${second}`;
  return visibleWidth(combined) <= width ? [combined] : [first, second];
}
