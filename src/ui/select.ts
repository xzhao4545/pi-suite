import { getSelectListTheme, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Input, SelectList, fuzzyFilter, getSelectPageIndex, truncateToWidth, type SelectItem } from '@earendil-works/pi-tui';
import { DoubleLeft, type ViewerNavigation } from './viewer/navigation.ts';
import { commandFrame } from './frame.ts';
import { isReadingScreen, openReading, type ReadingFactory } from './reading.ts';

/** Native input, paging and display-only truncation keep complete resource identities selectable. */
export function selectValue(ctx: ExtensionContext, title: string, items: SelectItem[], initial?: string, options: { filter?: boolean; navigation?: ViewerNavigation } = {}): Promise<string | undefined> {
  const factory: ReadingFactory<string | undefined> = (tui, theme, keys, done) => {
    const input = options.filter ? new Input({ prompt: 'Filter: ' }) : undefined;
    const doubleLeft = new DoubleLeft();
    let filtered = items;
    let maxVisible = Math.max(1, tui.terminal.rows - 6 - Number(Boolean(input)));
    const createList = (index: number) => {
      const next = new SelectList(filtered, maxVisible, getSelectListTheme());
      next.setSelectedIndex(index);
      return next;
    };
    let list = createList(items.findIndex(item => item.value === initial));
    const key = (action: Parameters<typeof keys.getKeys>[0]) => keys.getKeys(action).join('/');
    const hint = `${options.navigation && !input ? '←← close · ' : ''}${key('tui.select.confirm')} select · ${key('tui.select.cancel')} cancel · ${key('tui.select.up')}/${key('tui.select.down')} move · ${key('tui.select.pageUp')}/${key('tui.select.pageDown')} page`;
    return {
      capturesViewportInput: true,
      get focused() { return input?.focused ?? false; },
      set focused(value: boolean) { if (input) input.focused = value; },
      render(width: number) {
        const height = Math.max(1, tui.terminal.rows - 6 - Number(Boolean(input)));
        if (height !== maxVisible) {
          const index = filtered.indexOf(list.getSelectedItem()!);
          maxVisible = height; list = createList(index);
        }
        return commandFrame(width, [truncateToWidth(title, width), ...input ? input.render(width) : [],
          ...filtered.length ? list.render(width) : [theme.fg('warning', 'No matching items')], truncateToWidth(hint, width)], theme)
          .map(line => truncateToWidth(line, width));
      },
      dispose: () => doubleLeft.reset(),
      invalidate: () => { list.invalidate(); input?.invalidate(); },
      getSelectedItem: () => list.getSelectedItem(),
      handleInput(data: string) {
        if (!input && options.navigation && doubleLeft.handle(data)) { options.navigation.close(); done(undefined); return; }
        const selected = list.getSelectedItem(), index = filtered.indexOf(selected!);
        const page = getSelectPageIndex(keys, data, index, filtered.length, maxVisible);
        // SelectList reads a package-global key manager. Route named actions through the
        // injected host manager instead, while retaining its native selection/layout state.
        if (keys.matches(data, 'tui.select.cancel')) { done(undefined); return; }
        if (keys.matches(data, 'tui.select.confirm')) { if (selected) done(selected.value); return; }
        if (keys.matches(data, 'tui.select.up')) { if (filtered.length) list.setSelectedIndex((index - 1 + filtered.length) % filtered.length); }
        else if (keys.matches(data, 'tui.select.down')) { if (filtered.length) list.setSelectedIndex((index + 1) % filtered.length); }
        else if (page !== undefined) list.setSelectedIndex(page);
        else if (input) {
          const previous = input.getValue();
          input.handleInput(data);
          if (input.getValue() !== previous) {
            filtered = fuzzyFilter(items, input.getValue(), item => `${item.value} ${item.label ?? ''} ${item.description ?? ''}`);
            list = createList(0);
          }
        }
        tui.requestRender();
      },
    };
  };
  return isReadingScreen(ctx) ? openReading(ctx, factory) : ctx.ui.custom(factory);
}
