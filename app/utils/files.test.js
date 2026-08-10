import { describe, expect, test } from 'bun:test';
import { baseName, getExtension, pathUp, sanitizePath } from './files';

describe('pathUp', () => {
  test('strips the last segment', () => {
    expect(pathUp('/a/b/c')).toBe('/a/b');
  });

  test('strips a trailing slash first', () => {
    expect(pathUp('/a/b/')).toBe('/a');
  });

  test('returns root for root paths', () => {
    expect(pathUp('/')).toBe('/');
  });
});

describe('sanitizePath', () => {
  test('collapses repeated slashes', () => {
    expect(sanitizePath('/a//b///c')).toBe('/a/b/c');
  });
});

describe('baseName', () => {
  test('returns the file name', () => {
    expect(baseName('/photos/IMG_01.jpg')).toBe('IMG_01.jpg');
  });

  test('returns null for nullish input', () => {
    expect(baseName(null)).toBe(null);
    expect(baseName(undefined)).toBe(null);
  });
});

describe('getExtension', () => {
  test('returns the last extension for files', () => {
    expect(getExtension('foo.tar.gz', false)).toBe('.gz');
  });

  test('returns null for folders', () => {
    expect(getExtension('folder', true)).toBe(null);
  });
});
