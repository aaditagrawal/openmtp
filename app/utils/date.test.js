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

describe('local date contracts', () => {
  test('preserves local calendar strings and compact/year-month input', () => {
    for (const value of ['2020-01-02 03:04:05', '2020/1/2 03:04:05']) {
      expect(appDateFormat(value)).toBe('2020-01-02 03:04:05');
    }
    expect(appDateFormat('20200102')).toBe('2020-01-02 00:00:00');
    for (const day of ['20200102', '2020-01-02']) {
      expect(appDateFormat(`${day}T03`)).toBe('2020-01-02 03:00:00');
      expect(appDateFormat(`${day}T0304`)).toBe('2020-01-02 03:04:00');
      expect(appDateFormat(`${day}T030405`)).toBe('2020-01-02 03:04:05');
    }
    expect(appDateFormat('2020-01')).toBe('2020-01-01 00:00:00');
    expect(appDateFormat('2020-02-30')).toBe('2020-03-01 00:00:00');
    expect(appDateFormat('2020-00-00')).toBe('2019-11-30 00:00:00');
  });

  test('formats epoch and Date values and rejects invalid values', () => {
    expect(appDateFormat(new Date(0))).toBe(appDateFormat(0));
    for (const value of [null, '', 'not a date', new Date(NaN)])
      expect(appDateFormat(value)).toBe('Invalid Date');
    expect(Number.isNaN(daysDiff('bad', '2020-01-01'))).toBe(true);
    expect(daysDiff('2020-01-01', '2020-01-02')).toBe(-1);
    expect(daysDiff('2020-01-01 01:00:00', '2020-01-01 02:00:00')).toBe(0);
  });

  test('counts calendar days across daylight saving changes', () => {
    const previousTZ = process.env.TZ;
    try {
      process.env.TZ = 'America/New_York';
      expect(daysDiff('2024-03-11', '2024-03-09')).toBe(2);
      expect(daysDiff('2024-11-04', '2024-11-02')).toBe(2);
      expect(appDateFormat('2020-01-02T03:04:05.000Z')).toBe(
        '2020-01-01 22:04:05',
      );
      expect(appDateFormat('2020-01-02T03:04:05+05:30')).toBe(
        '2020-01-01 16:34:05',
      );
    } finally {
      if (previousTZ === undefined) delete process.env.TZ;
      else process.env.TZ = previousTZ;
    }
  });
});
