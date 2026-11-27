import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countText, elapsedText } from '../../src/ui/format.ts';

test('elapsedText floors elapsed time and displays at most two units', () => {
  for (const [ms, expected] of [
    [-1, '0s'],
    [0, '0s'],
    [59_999, '59s'],
    [60_000, '1m00s'],
    [3_599_999, '59m59s'],
    [3_600_000, '1h00m'],
    [86_399_999, '23h59m'],
    [86_400_000, '1d00h'],
  ] as const) assert.equal(elapsedText(ms), expected, `${ms} ms`);
});

test('countText compacts token counts without rounding up', () => {
  for (const [count, expected] of [
    [0, '0'],
    [999, '999'],
    [1_000, '1k'],
    [1_234, '1.2k'],
    [12_000, '12k'],
    [999_999, '999.9k'],
    [1_000_000, '1M'],
    [1_250_000_000, '1.2B'],
  ] as const) assert.equal(countText(count), expected, `${count} tokens`);
});
