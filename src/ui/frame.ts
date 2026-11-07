import { DynamicBorder, type Theme } from '@earendil-works/pi-coding-agent';

/** Callers reserve two rows in their viewport budget and offset mouse rows by one. */
export function commandFrame(width: number, content: string[], theme?: Theme): string[] {
  // Extensions supply their theme explicitly because Pi's module cache may differ.
  const border = new DynamicBorder(text => theme ? theme.fg('border', text) : text).render(width);
  return [...border, ...content, ...border];
}
