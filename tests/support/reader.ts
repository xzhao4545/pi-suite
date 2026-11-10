import xterm from '@xterm/headless';
import { TuiAltScreen, TuiMainScreen, type TUI, type Terminal } from '@earendil-works/pi-tui';
import { terminal } from './terminal.ts';

/** Exercise Pi's terminal parser, viewport renderer and real ANSI output, not a local mouse router. */
export const readerTerminal = (rows = 24, columns = 40) => createReader(rows, columns, device => new TuiAltScreen(device));
export const regularReaderTerminal = (rows = 24, columns = 40) => createReader(rows, columns, device => new TuiMainScreen(device));
function createReader<T extends TUI>(rows: number, columns: number, create: (device: Terminal) => T) {
  const screen = new xterm.Terminal({rows, cols: columns, allowProposedApi: true});
  let input!: (data: string) => void, resized!: () => void;
  const writes: string[] = [];
  const device: Terminal = {...terminal(rows, columns).terminal,
    start: (onInput, onResize) => {input = onInput; resized = onResize;},
    write: data => {writes.push(data); screen.write(data);},
  };
  const tui = create(device);
  tui.start();
  return {tui, writes,
    send(data: string) { input(data); tui.renderNow(); },
    resize(rows: number, columns: number) { Object.assign(device, {rows, columns}); screen.resize(columns, rows); resized(); tui.renderNow(); },
    async lines() {
      await new Promise<void>(resolve => screen.write('', resolve));
      return Array.from({length: device.rows}, (_, row) => screen.buffer.active.getLine(screen.buffer.active.viewportY + row)?.translateToString(true) ?? '');
    },
    dispose() {tui.stop({preserveScreen: true}); screen.dispose();},
  };
}
