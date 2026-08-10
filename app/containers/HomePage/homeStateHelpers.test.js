import { describe, expect, test } from 'bun:test';
import {
  EMPTY_NODES,
  EMPTY_SELECTED,
  mtpDevicePatchIsNoop,
  normalizeNodes,
  normalizeSelected,
} from './homeStateHelpers';

describe('normalizeSelected', () => {
  test('returns stable empty for null/undefined/[]', () => {
    expect(normalizeSelected(null)).toBe(EMPTY_SELECTED);
    expect(normalizeSelected(undefined)).toBe(EMPTY_SELECTED);
    expect(normalizeSelected([])).toBe(EMPTY_SELECTED);
  });

  test('returns same non-empty array reference', () => {
    const selected = ['/a', '/b'];

    expect(normalizeSelected(selected)).toBe(selected);
  });
});

describe('normalizeNodes', () => {
  test('returns stable empty for null/undefined/[]', () => {
    expect(normalizeNodes(null)).toBe(EMPTY_NODES);
    expect(normalizeNodes(undefined)).toBe(EMPTY_NODES);
    expect(normalizeNodes([])).toBe(EMPTY_NODES);
  });

  test('returns same non-empty array reference', () => {
    const nodes = [{ path: '/a' }];

    expect(normalizeNodes(nodes)).toBe(nodes);
  });
});

describe('mtpDevicePatchIsNoop', () => {
  test('true when all patch keys already match', () => {
    expect(
      mtpDevicePatchIsNoop(
        { isAvailable: true, isLoading: false, error: null },
        { isAvailable: true, isLoading: false },
      ),
    ).toBe(true);
  });

  test('false when any patch key differs', () => {
    expect(
      mtpDevicePatchIsNoop(
        { isAvailable: true, isLoading: true },
        { isAvailable: true, isLoading: false },
      ),
    ).toBe(false);
  });

  test('false for empty patch or missing device', () => {
    expect(mtpDevicePatchIsNoop({ isAvailable: true }, {})).toBe(false);
    expect(mtpDevicePatchIsNoop(null, { isLoading: true })).toBe(false);
  });
});
