// Split from pi-interactive-shell 0.18.0 pty-session.ts (MIT, third-party/licenses/pi-interactive-shell.txt):
// pure cell-to-SGR rendering for the headless xterm buffer.
import type { IBufferCell, IBufferLine } from '@xterm/headless';

const OSC_REGEX = /\x1b\][^\x07]*(?:\x07|\x1b\\)/g;
const APC_REGEX = /\x1b_[^\x07\x1b]*(?:\x07|\x1b\\)/g;
const DCS_REGEX = /\x1bP[^\x07\x1b]*(?:\x07|\x1b\\)/g;
const CSI_REGEX = /\x1b\[[0-9;?]*[A-Za-z]/g;
const ESC_SINGLE_REGEX = /\x1b[@-_]/g;
const CONTROL_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1A\x1C-\x1F\x7F]/g;

export function sanitizeLine(line: string): string {
  let out = line;
  if (out.includes('\u001b')) {
    out = out.replace(OSC_REGEX, '').replace(APC_REGEX, '').replace(DCS_REGEX, '')
      .replace(CSI_REGEX, match => (match.endsWith('m') ? match : '')).replace(ESC_SINGLE_REGEX, '');
  }
  return out.replace(/\t/g, '   ').replace(/\r/g, '').replace(CONTROL_REGEX, '');
}

type ColorMode = 'default' | 'palette' | 'rgb';
type CellStyle = {
  bold: boolean; dim: boolean; italic: boolean; underline: boolean; inverse: boolean; invisible: boolean; strikethrough: boolean;
  fgMode: ColorMode; fg: number; bgMode: ColorMode; bg: number;
};

function styleKey(style: CellStyle): string {
  return [style.bold ? 'b' : '-', style.dim ? 'd' : '-', style.italic ? 'i' : '-', style.underline ? 'u' : '-',
    style.inverse ? 'v' : '-', style.invisible ? 'x' : '-', style.strikethrough ? 's' : '-',
    `fg:${style.fgMode}:${style.fg}`, `bg:${style.bgMode}:${style.bg}`].join('');
}
function colorSgr(isFg: boolean, mode: ColorMode, value: number): string[] {
  if (mode === 'rgb') return [`${isFg ? 38 : 48};2;${(value >> 16) & 0xff};${(value >> 8) & 0xff};${value & 0xff}`];
  return mode === 'palette' ? [`${isFg ? 38 : 48};5;${value}`] : [];
}
function sgrForStyle(style: CellStyle): string {
  const flags: [boolean, string][] = [[style.bold, '1'], [style.dim, '2'], [style.italic, '3'], [style.underline, '4'],
    [style.inverse, '7'], [style.invisible, '8'], [style.strikethrough, '9']];
  const parts = ['0', ...flags.filter(([on]) => on).map(([, code]) => code),
    ...colorSgr(true, style.fgMode, style.fg), ...colorSgr(false, style.bgMode, style.bg)];
  return `\u001b[${parts.join(';')}m`;
}
function cellColor(cell: IBufferCell | undefined, fg: boolean): { mode: ColorMode; value: number } {
  const mode: ColorMode = (fg ? cell?.isFgDefault() : cell?.isBgDefault()) ? 'default'
    : (fg ? cell?.isFgRGB() : cell?.isBgRGB()) ? 'rgb' : (fg ? cell?.isFgPalette() : cell?.isBgPalette()) ? 'palette' : 'default';
  const value = (fg ? cell?.getFgColor() : cell?.getBgColor()) ?? 0;
  // xterm uses palette values >= 256 for defaults/specials; never emit invalid 38;5;N codes.
  return mode === 'palette' && (value < 0 || value > 255) ? { mode: 'default', value: 0 } : { mode, value };
}

export function renderLineFromCells(line: IBufferLine | undefined, cols: number): string {
  let currentKey = '';
  let out = '';
  for (let x = 0; x < cols; x++) {
    const cell = line?.getCell(x);
    if ((cell?.getWidth() ?? 1) === 0) continue;
    const fg = cellColor(cell, true), bg = cellColor(cell, false);
    const style: CellStyle = { bold: !!cell?.isBold(), dim: !!cell?.isDim(), italic: !!cell?.isItalic(), underline: !!cell?.isUnderline(),
      inverse: !!cell?.isInverse(), invisible: !!cell?.isInvisible(), strikethrough: !!cell?.isStrikethrough(),
      fgMode: fg.mode, fg: fg.value, bgMode: bg.mode, bg: bg.value };
    const key = styleKey(style);
    if (key !== currentKey) { currentKey = key; out += sgrForStyle(style); }
    out += cell?.getChars() || ' ';
  }
  return out + '\u001b[0m';
}
