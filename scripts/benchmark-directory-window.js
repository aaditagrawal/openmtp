import '../tests/manual/guard.js';
// Run with: bun scripts/benchmark-directory-window.js
// This isolates JS element construction. It excludes Electron layout/paint and
// disk IO; use the running app to measure those independently.
import React from 'react';
import { directoryWindow } from '../app/utils/directoryWindow';

const createRows = (items) =>
  items.map((item) => React.createElement('tr', { key: item.path, item }));

function measure(run) {
  const timings = [];
  let result;

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const start = performance.now();

    result = run();
    timings.push(performance.now() - start);
  }

  timings.sort((a, b) => a - b);

  return { ...result, medianMs: Number(timings[1].toFixed(3)) };
}

for (const count of [1000, 10000]) {
  const items = Array.from({ length: count }, (_, index) => ({
    path: `/fixture/file-${String(index).padStart(6, '0')}.txt`,
  }));
  const previous = measure(() => {
    let rowVisits = 0;
    let commits = 0;

    for (let end = 50; end < count + 50; end += 50) {
      rowVisits += createRows(items.slice(0, Math.min(end, count))).length;
      commits += 1;
    }

    return { rowVisits, commits, mountedRows: count };
  });
  const windowed = measure(() => {
    const range = directoryWindow({
      count,
      rowHeight: 54,
      viewportHeight: 800,
    });
    const rendered = createRows(items.slice(range.start, range.end));

    return {
      rowVisits: rendered.length,
      commits: 1,
      mountedRows: rendered.length,
    };
  });

  console.info(JSON.stringify({ entries: count, previous, windowed }));
}
