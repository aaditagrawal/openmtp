import path from 'path';
import { readdir, realpath, stat } from 'fs/promises';
import { filterDirents } from './dirListing';

// Bound filesystem work so large folders do not monopolize the renderer or
// exhaust file descriptors. Preserve readdir order regardless of completion.
export async function mapConcurrent(items, callback, concurrency = 32) {
  const result = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        result[index] = await callback(items[index], index);
      }
    }),
  );
  return result;
}

export async function readDirectoryEntries(filePath, options = {}) {
  const dirents = filterDirents(
    await readdir(filePath, { withFileTypes: true }),
    options,
  );
  const entries = await mapConcurrent(dirents, async (dirent) => {
    const fullPath = path.resolve(filePath, dirent.name);
    try {
      const metadata = await stat(fullPath);
      const symlink = dirent.isSymbolicLink() ? await realpath(fullPath) : null;
      return {
        name: dirent.name,
        path: fullPath,
        extension: path.extname(fullPath),
        size: metadata.size,
        isFolder: metadata.isDirectory(),
        mtimeMs: metadata.mtimeMs,
        symlink,
      };
    } catch (error) {
      // A disappearing file or broken symlink does not invalidate its folder.
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
      throw error;
    }
  });
  return entries.filter(Boolean);
}

export async function readDirectoryTree(filePath, options = {}) {
  const root = await realpath(filePath);
  if (!(await stat(root)).isDirectory()) {
    const error = new Error(`Not a directory: ${filePath}`);
    error.code = 'ENOTDIR';
    throw error;
  }
  // Each directory shares its parent chain. Copying a Set at every level
  // retains O(directories * depth) ancestor references on deep trees.
  const queue = [{ path: filePath, canonicalPath: root, parent: null }];
  const result = [];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    queue[index] = null;
    const entries = await readDirectoryEntries(current.path, options);
    for (const entry of entries) {
      if (!entry.isFolder) {
        result.push(entry);
        continue;
      }
      const resolved = entry.symlink || (await realpath(entry.path));
      for (let ancestor = current; ancestor; ancestor = ancestor.parent) {
        if (ancestor.canonicalPath === resolved) {
          // Check this branch only: sibling aliases are valid, but cycles
          // must fail closed so Smart Sync never uses an incomplete listing.
          const error = new Error(`Directory symlink cycle: ${entry.path}`);
          error.code = 'ELOOP';
          throw error;
        }
      }
      queue.push({
        path: entry.path,
        canonicalPath: resolved,
        parent: current,
      });
    }
  }
  return result;
}
