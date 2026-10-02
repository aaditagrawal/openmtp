import './guard';
import { describe, expect, test } from 'bun:test';
import { smartSyncListing } from '../../app/utils/smartSync';

describe('Smart Sync scan errors', () => {
  test('directory cycles and permission failures stop sync instead of overwriting', () => {
    for (const side of ['source', 'destination']) {
      for (const code of ['ELOOP', 'EACCES', 'EIO']) {
        const error = Object.assign(new Error('scan failed'), { code });
        expect(() =>
          smartSyncListing({ error }, { side, root: '/files' }),
        ).toThrow(error);
      }
    }
  });

  test('only confirmed file roots and absent destinations permit fallback', () => {
    expect(
      smartSyncListing(
        { error: 'ENOTDIR' },
        { side: 'source', root: '/photo.jpg' },
      ),
    ).toBeNull();
    expect(
      smartSyncListing(
        { error: { code: 'ENOENT' } },
        { side: 'destination', root: '/missing' },
      ),
    ).toBeNull();
    expect(() =>
      smartSyncListing(
        { error: { code: 'ENOENT' } },
        { side: 'source', root: '/missing' },
      ),
    ).toThrow();
    expect(() =>
      smartSyncListing(
        { error: 'ENOTDIR' },
        { side: 'destination', root: '/photo.jpg' },
      ),
    ).toThrow();
  });

  test('recognizes native file roots and null empty directories', () => {
    const result = { data: [{ path: '/photo.jpg', isFolder: false }] };
    expect(
      smartSyncListing(result, { side: 'source', root: '/photo.jpg' }),
    ).toBeNull();
    expect(() =>
      smartSyncListing(result, { side: 'destination', root: '/photo.jpg' }),
    ).toThrow();
    expect(
      smartSyncListing({ data: null }, { side: 'destination', root: '/empty' }),
    ).toEqual([]);
    expect(
      smartSyncListing({ data: [] }, { side: 'source', root: '/empty' }),
    ).toEqual([]);
  });

  test('matches native missing-path errors narrowly and rejects device failures', () => {
    for (const message of [
      'path not found: /missing',
      'path does not Exists. path: /missing',
      'file not found: /missing',
    ]) {
      expect(
        smartSyncListing(
          { error: message, stderr: 'ErrorInvalidPath' },
          { side: 'destination', root: '/missing' },
        ),
      ).toBeNull();
    }
    for (const result of [
      {
        error: 'invalid path: both objectId and fullPath cannot be empty',
        stderr: 'ErrorInvalidPath',
      },
      { error: 'device disconnected', stderr: 'ErrorMtpDetectFailed' },
      { error: null, stderr: 'ErrorFilePermission' },
      {},
    ]) {
      expect(() =>
        smartSyncListing(result, { side: 'destination', root: '/files' }),
      ).toThrow();
    }
  });
});
