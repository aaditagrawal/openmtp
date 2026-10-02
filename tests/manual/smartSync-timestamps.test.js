import './guard.js';
import { expect, test } from 'bun:test';
import { computeSmartSyncDiff } from '../../app/utils/smartSync';

const instant = Date.parse('2026-10-02T15:00:03.000Z');
const cases = [
  [
    'numeric timestamps retain submillisecond differences',
    { mtimeMs: instant + 0.5 },
    { mtimeMs: instant },
    true,
  ],
  [
    'same-second upload skips fractional filesystem time',
    { mtimeMs: instant + 636 },
    { dateAdded: '2026-10-02T15:00:03.000Z' },
    false,
  ],
  [
    'same-second download skips fractional date text',
    { dateAdded: '2026-10-02T15:00:03.636Z' },
    { mtimeMs: instant },
    false,
  ],
  [
    'newer whole second transfers',
    { mtimeMs: instant + 1000 },
    { dateAdded: '2026-10-02T15:00:03.000Z' },
    true,
  ],
  [
    'older remote timestamp skips',
    { dateAdded: '2026-10-02T15:00:02.000Z' },
    { mtimeMs: instant },
    false,
  ],
  [
    'both numeric timestamps retain millisecond precision',
    { mtimeMs: instant + 1 },
    { mtimeMs: instant },
    true,
  ],
  [
    'equal numeric timestamps skip',
    { mtimeMs: instant },
    { mtimeMs: instant },
    false,
  ],
  [
    'equal instants with different timezone text skip',
    { dateAdded: '2026-10-02T20:30:03+05:30' },
    { dateAdded: '2026-10-02T15:00:03.000Z' },
    false,
  ],
  [
    'size change still transfers within same second',
    { mtimeMs: instant + 636, size: 2048 },
    { dateAdded: '2026-10-02T15:00:03.000Z' },
    true,
  ],
];
for (const [name, sourceTime, destinationTime, transfers] of cases) {
  test(name, () => {
    const source = {
      path: '/source/photo.jpg',
      size: 1024,
      isFolder: false,
      ...sourceTime,
    };
    const destination = {
      path: '/target/photo.jpg',
      size: 1024,
      isFolder: false,
      ...destinationTime,
    };
    const diff = computeSmartSyncDiff({
      sourceRoot: '/source',
      destRoot: '/target',
      sourceFiles: [source],
      destFiles: [destination],
    });
    expect(diff.filesToTransfer).toEqual(transfers ? [source] : []);
    expect(diff.summary).toEqual({
      newFiles: 0,
      modifiedFiles: transfers ? 1 : 0,
      unchangedSkipped: transfers ? 0 : 1,
      extrasCount: 0,
    });
  });
}
