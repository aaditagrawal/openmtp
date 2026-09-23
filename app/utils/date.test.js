import { describe, expect, test } from 'bun:test';
import { appDateFormat, daysDiff, msToTime } from './date';

describe('msToTime', () => {
  test('formats hours minutes seconds', () => {
    expect(msToTime(3661000)).toBe('01:01:01');
  });

  test('formats zero', () => {
    expect(msToTime(0)).toBe('00:00:00');
  });
});

describe('daysDiff', () => {
  test('returns day difference', () => {
    expect(daysDiff('2020-01-10', '2020-01-01')).toBe(9);
  });
});

describe('appDateFormat', () => {
  test('formats ISO timestamps', () => {
    expect(appDateFormat('2020-01-02T03:04:05.000Z')).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    );
  });
});
