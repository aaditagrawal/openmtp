// Keep a few rows outside the viewport so wheel/trackpad scrolling stays smooth.
export function directoryWindow({
  count,
  columns = 1,
  rowHeight,
  viewportHeight,
  scrollTop = 0,
  overscan = 4,
}) {
  const rows = Math.ceil(count / columns);
  const visibleRows = Math.max(1, Math.ceil(viewportHeight / rowHeight));
  const firstVisible = Math.min(
    Math.max(0, rows - 1),
    Math.max(0, Math.floor(scrollTop / rowHeight)),
  );
  const firstRow = Math.max(0, firstVisible - overscan);
  const lastRow = Math.min(rows, firstVisible + visibleRows + overscan + 1);

  return {
    start: firstRow * columns,
    end: Math.min(count, lastRow * columns),
    before: firstRow * rowHeight,
    after: Math.max(0, rows - lastRow) * rowHeight,
  };
}
