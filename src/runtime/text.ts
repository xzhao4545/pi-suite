import { stripVTControlCharacters } from 'node:util';

/** Safe literal program/user text: retain layout, discard terminal transport controls. */
export function sanitizeText(raw: string): string {
  return stripVTControlCharacters(raw).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}
