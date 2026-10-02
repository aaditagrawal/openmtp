import './guard';
import { describe, expect, test } from 'bun:test';
import { directoryWindow } from '../../app/utils/directoryWindow';

describe('directory window', () => {
  test('a hundred thousand entries mount only the visible rows and overscan', () => {
    const range = directoryWindow({
      count: 100000,
      rowHeight: 54,
      viewportHeight: 800,
      scrollTop: 2000000,
    });

    expect(range.end - range.start).toBeLessThanOrEqual(24);
    expect(range.before + (range.end - range.start) * 54 + range.after).toBe(
      5400000,
    );
  });

  test('every grid viewport is covered and spacers preserve total height', () => {
    for (const columns of [1, 3, 6, 12]) {
      const count = 10001;
      const rowHeight = 137;
      const height = 800;
      const totalRows = Math.ceil(count / columns);

      for (
        let scrollTop = 0;
        scrollTop < totalRows * rowHeight;
        scrollTop += 701
      ) {
        const range = directoryWindow({
          count,
          columns,
          rowHeight,
          viewportHeight: height,
          scrollTop,
        });
        const visibleStart = Math.floor(scrollTop / rowHeight) * columns;
        const visibleEnd = Math.min(
          count,
          Math.ceil((scrollTop + height) / rowHeight) * columns,
        );

        expect(range.start).toBeLessThanOrEqual(visibleStart);
        expect(range.end).toBeGreaterThanOrEqual(visibleEnd);
        expect(range.start % columns).toBe(0);
        expect(
          range.before +
            Math.ceil((range.end - range.start) / columns) * rowHeight +
            range.after,
        ).toBe(totalRows * rowHeight);
      }
    }
  });

  test('stale scroll positions after a directory shrinks still include the last item', () => {
    const range = directoryWindow({
      count: 3,
      rowHeight: 54,
      viewportHeight: 800,
      scrollTop: 100000,
    });

    expect(range).toEqual({ start: 0, end: 3, before: 0, after: 0 });
  });

  test('empty directories have no spacers or rows', () => {
    expect(
      directoryWindow({ count: 0, rowHeight: 54, viewportHeight: 800 }),
    ).toEqual({ start: 0, end: 0, before: 0, after: 0 });
  });
});
