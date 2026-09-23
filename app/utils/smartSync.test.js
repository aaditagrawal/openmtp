import { describe, expect, test } from 'bun:test';
import { computeSmartSyncDiff, groupFilesByParentDir } from './smartSync';

const file = ({ path, size = 10, dateAdded = '2024-01-01T00:00:00.000Z' }) => ({
  path,
  size,
  dateAdded,
  isFolder: false,
});

describe('computeSmartSyncDiff', () => {
  test('transfers source-only files as new', () => {
    const result = computeSmartSyncDiff({
      sourceRoot: '/src',
      destRoot: '/dst',
      sourceFiles: [file({ path: '/src/a.txt' })],
      destFiles: [],
    });

    expect(result.summary.newFiles).toBe(1);
    expect(result.filesToTransfer).toHaveLength(1);
    expect(result.summary.unchangedSkipped).toBe(0);
  });

  test('skips unchanged files with same size and date', () => {
    const result = computeSmartSyncDiff({
      sourceRoot: '/src',
      destRoot: '/dst',
      sourceFiles: [file({ path: '/src/a.txt', size: 5 })],
      destFiles: [file({ path: '/dst/a.txt', size: 5 })],
    });

    expect(result.summary.unchangedSkipped).toBe(1);
    expect(result.filesToTransfer).toHaveLength(0);
  });

  test('transfers when size differs or source is newer', () => {
    const result = computeSmartSyncDiff({
      sourceRoot: '/src',
      destRoot: '/dst',
      sourceFiles: [
        file({
          path: '/src/a.txt',
          size: 11,
          dateAdded: '2024-02-01T00:00:00.000Z',
        }),
      ],
      destFiles: [
        file({
          path: '/dst/a.txt',
          size: 10,
          dateAdded: '2024-01-01T00:00:00.000Z',
        }),
      ],
    });

    expect(result.summary.modifiedFiles).toBe(1);
    expect(result.filesToTransfer).toHaveLength(1);
  });

  test('collects destination-only extras', () => {
    const result = computeSmartSyncDiff({
      sourceRoot: '/src',
      destRoot: '/dst',
      sourceFiles: [],
      destFiles: [file({ path: '/dst/extra.txt' })],
    });

    expect(result.extrasInDest).toHaveLength(1);
    expect(result.summary.extrasCount).toBe(1);
  });

  test('prefers numeric mtimeMs over dateAdded strings', () => {
    const result = computeSmartSyncDiff({
      sourceRoot: '/src',
      destRoot: '/dst',
      sourceFiles: [
        {
          path: '/src/a.txt',
          size: 10,
          isFolder: false,
          dateAdded: '2024-01-01 00:00:00',
          mtimeMs: 2_000,
        },
      ],
      destFiles: [
        {
          path: '/dst/a.txt',
          size: 10,
          isFolder: false,
          dateAdded: '2024-06-01 00:00:00',
          mtimeMs: 1_000,
        },
      ],
    });

    expect(result.summary.modifiedFiles).toBe(1);
  });

  test('ignores folders and matches paths case-insensitively', () => {
    const result = computeSmartSyncDiff({
      sourceRoot: '/src',
      destRoot: '/dst',
      sourceFiles: [
        { path: '/src/dir', isFolder: true, size: 0, dateAdded: '2024-01-01' },
        file({ path: '/src/Photo.JPG', size: 3 }),
      ],
      destFiles: [file({ path: '/dst/photo.jpg', size: 3 })],
    });

    expect(result.summary.unchangedSkipped).toBe(1);
    expect(result.filesToTransfer).toHaveLength(0);
  });
});

describe('groupFilesByParentDir', () => {
  test('batches files by parent directory', () => {
    const batches = groupFilesByParentDir({
      sourceRoot: '/src',
      destRoot: '/dst',
      filesToTransfer: [
        file({ path: '/src/a/one.txt' }),
        file({ path: '/src/a/two.txt' }),
        file({ path: '/src/b/three.txt' }),
      ],
    });

    expect(batches).toHaveLength(2);

    const batchA = batches.find((batch) => batch.sourceDir.endsWith('/a'));
    const batchB = batches.find((batch) => batch.sourceDir.endsWith('/b'));

    expect(batchA.files).toEqual(['/src/a/one.txt', '/src/a/two.txt']);
    expect(batchB.destDir.endsWith('/b')).toBe(true);
  });
});
