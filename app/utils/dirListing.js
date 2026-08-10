import junk from 'junk';

/**
 * True for dotfile / hidden path segments (e.g. `.git`, `foo/.bar`).
 * No sticky `g` flag — safe for repeated `.test()` calls.
 */
export const isIgnoredHiddenName = (name) =>
  typeof name === 'string' && /(^|\/)\.[^/.]/.test(name);

/**
 * Filter readdir basenames: drop junk, optionally drop hidden names.
 */
export const filterListedNames = (names, { ignoreHidden = false } = {}) => {
  if (!Array.isArray(names)) {
    return [];
  }

  let files = names.filter(junk.not);

  if (ignoreHidden) {
    files = files.filter((item) => !isIgnoredHiddenName(item));
  }

  return files;
};

/**
 * Same filters for `fs.Dirent` entries from `readdir({ withFileTypes: true })`.
 */
export const filterDirents = (dirents, { ignoreHidden = false } = {}) => {
  if (!Array.isArray(dirents)) {
    return [];
  }

  return dirents.filter((entry) => {
    if (!junk.not(entry.name)) {
      return false;
    }

    if (ignoreHidden && isIgnoredHiddenName(entry.name)) {
      return false;
    }

    return true;
  });
};
