import { getSelectListTheme, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { SelectList, truncateToWidth, type SelectItem } from '@earendil-works/pi-tui';

/** Native paging and display-only truncation keep long resource identities selectable on phones. */
export function selectValue(ctx: ExtensionContext, title: string, items: SelectItem[], initial?: string): Promise<string | undefined> {
  return ctx.ui.custom<string | undefined>((tui, _theme, _keys, done) => {
    const list = new SelectList(items, Math.max(1, tui.terminal.rows - 4), getSelectListTheme());
    list.setSelectedIndex(items.findIndex(item => item.value === initial));
    list.onSelect = item => done(item.value);
    list.onCancel = () => done(undefined);
    return {
      render: (width: number) => [truncateToWidth(title, width), ...list.render(width), truncateToWidth('↑↓ / PgUp PgDn · Enter select · Esc cancel', width)],
      invalidate: () => list.invalidate(),
      handleInput: (data: string) => { list.handleInput(data); tui.requestRender(); },
    };
  });
}
