import { describe, expect, test } from 'bun:test';
import { filterPasteQueueSkippingExisting } from './pasteQueue';

describe('filterPasteQueueSkippingExisting', () => {
  test('keeps sources that do not already exist at the destination', () => {
    expect(
      filterPasteQueueSkippingExisting({
        queue: ['/src/a.txt', '/src/b.txt'],
        destinationFolder: '/dst',
        existingPaths: ['/dst/a.txt'],
      }),
    ).toEqual(['/src/b.txt']);
  });

  test('returns an empty queue when everything already exists', () => {
    expect(
      filterPasteQueueSkippingExisting({
        queue: ['/src/a.txt'],
        destinationFolder: '/dst/',
        existingPaths: ['/dst/a.txt'],
      }),
    ).toEqual([]);
  });

  test('handles empty inputs safely', () => {
    expect(
      filterPasteQueueSkippingExisting({
        queue: [],
        destinationFolder: '/dst',
        existingPaths: [],
      }),
    ).toEqual([]);
  });
});
