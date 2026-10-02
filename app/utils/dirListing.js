import { isNotJunk } from 'junk';

/**
 * True for dotfile / hidden path segments (e.g. `.git`, `foo/.bar`).
 * No sticky `g` flag — safe for repeated `.test()` calls.
 */
export const isIgnoredHiddenName = (name) =>
  typeof name === 'string' && /(^|\/)\.[^/.]/.test(name);

/**
 * Same filters for `fs.Dirent` entries from `readdir({ withFileTypes: true })`.
 */
export const filterDirents = (dirents, { ignoreHidden = false } = {}) => {
  if (!Array.isArray(dirents)) {
    return [];
  }

  return dirents.filter((entry) => {
    if (!isNotJunk(entry.name)) {
      return false;
    }

    if (ignoreHidden && isIgnoredHiddenName(entry.name)) {
      return false;
    }

    return true;
  });
};
