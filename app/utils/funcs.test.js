import { describe, expect, test } from 'bun:test';
import {
  arrayIntersection,
  isEmpty,
  niceBytes,
  percentage,
  springTruncate,
  toggleFileExplorerDeviceType,
} from './funcs';

describe('niceBytes', () => {
  test('formats zero', () => {
    expect(niceBytes(0)).toBe('0 Bytes');
  });

  test('formats kilobytes', () => {
    expect(niceBytes(1536, 1)).toBe('1.5 KB');
  });
});

describe('percentage', () => {
  test('returns integer percent', () => {
    expect(percentage(25, 100)).toBe(25);
  });
});

describe('springTruncate', () => {
  test('marks long strings as truncated', () => {
    const result = springTruncate('abcdefghij', 6);

    expect(result.isTruncated).toBe(true);
    expect(result.truncatedText.includes('...')).toBe(true);
  });
});

describe('isEmpty', () => {
  test('treats empty containers and null as empty', () => {
    expect(isEmpty({})).toBe(true);
    expect(isEmpty([])).toBe(true);
    expect(isEmpty(null)).toBe(true);
  });

  test('treats populated values as non-empty', () => {
    expect(isEmpty({ a: 1 })).toBe(false);
    expect(isEmpty([1])).toBe(false);
  });
});

describe('arrayIntersection', () => {
  test('returns shared members', () => {
    expect(arrayIntersection([1, 2, 3], [2, 3, 4])).toEqual([2, 3]);
  });
});

describe('toggleFileExplorerDeviceType', () => {
  const devices = { local: 'local', mtp: 'mtp' };

  test('toggles local to mtp', () => {
    expect(toggleFileExplorerDeviceType('local', devices)).toBe('mtp');
  });

  test('toggles mtp to local', () => {
    expect(toggleFileExplorerDeviceType('mtp', devices)).toBe('local');
  });
});
