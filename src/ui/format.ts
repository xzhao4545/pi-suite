const pad = (value: number): string => String(value).padStart(2, '0');

/** Show only completed units so a live timer never advances early. */
export function elapsedText(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m${pad(seconds % 60)}s`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h${pad(minutes % 60)}m`;

  return `${Math.floor(hours / 24)}d${pad(hours % 24)}h`;
}

const countUnits = [[1e9, 'B'], [1e6, 'M'], [1e3, 'k']] as const;

/** Truncate to tenths so a compact count never shows tokens not yet used. */
export function countText(n: number): string {
  for (const [unit, suffix] of countUnits) {
    if (n >= unit) return `${Math.floor(n / (unit / 10)) / 10}${suffix}`;
  }
  return String(n);
}
