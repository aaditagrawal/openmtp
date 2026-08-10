import {
  filterDirents,
  filterListedNames,
  isIgnoredHiddenName,
} from './dirListing';

describe('dirListing', () => {
  test('isIgnoredHiddenName detects dotfiles without sticky regex state', () => {
    expect(isIgnoredHiddenName('.DS_Store')).toBe(true);
    expect(isIgnoredHiddenName('.DS_Store')).toBe(true);
    expect(isIgnoredHiddenName('photos')).toBe(false);
    expect(isIgnoredHiddenName('foo/.bar')).toBe(true);
  });

  test('filterListedNames drops junk and optionally hidden names', () => {
    const names = ['photo.jpg', '.hidden', 'Thumbs.db', 'keep.txt'];

    expect(filterListedNames(names)).toEqual([
      'photo.jpg',
      '.hidden',
      'keep.txt',
    ]);
    expect(filterListedNames(names, { ignoreHidden: true })).toEqual([
      'photo.jpg',
      'keep.txt',
    ]);
  });

  test('filterDirents mirrors name filtering', () => {
    const dirents = [
      { name: 'a.txt' },
      { name: '.secret' },
      { name: 'Thumbs.db' },
    ];

    expect(
      filterDirents(dirents, { ignoreHidden: true }).map((d) => d.name),
    ).toEqual(['a.txt']);
  });
});
