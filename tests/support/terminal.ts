import { TuiMainScreen, type TUI, type Terminal } from "@earendil-works/pi-tui";
import { initTheme } from "@earendil-works/pi-coding-agent";

initTheme("dark", false);
export function terminal(rows = 24, columns = 40): TUI {
  const device: Terminal = {
    rows, columns, kittyProtocolActive: false,
    start() {}, stop() {}, async drainInput() {}, write() {}, moveBy() {}, hideCursor() {}, showCursor() {},
    clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {},
  };
  return new TuiMainScreen(device);
}
