import path from 'path';
import { MTP_ERROR } from '../enums/mtpError';

// null requests an ordinary transfer only for a file source or a missing
// destination. A failed directory scan must never become an overwrite fallback.
export function smartSyncListing(result, { side, root }) {
  const error = result?.error;
  const code = typeof error === 'string' ? error : error?.code;
  const message = error?.message || (typeof error === 'string' ? error : '');
  const mtpMissing =
    result?.stderr === MTP_ERROR.ErrorFileNotFound ||
    (result?.stderr === MTP_ERROR.ErrorInvalidPath &&
      /^(?:path does not Exists\. path:|path not found:|file not found:)/i.test(
        message,
      ));

  if (error || result?.stderr) {
    if (side === 'source' && code === 'ENOTDIR') return null;
    if (side === 'destination' && (code === 'ENOENT' || mtpMissing))
      return null;
    if (error instanceof Error) throw error;
    throw new Error(`Cannot scan ${side} ${root}: ${message || result.stderr}`);
  }

  // Kalam serializes an empty Go slice as null.
  const entries = result?.data === null ? [] : result?.data;
  if (!Array.isArray(entries)) {
    throw new Error(`Invalid directory listing for ${side} ${root}`);
  }
  // mtpx.Walk returns the file itself when its root is a file, unlike local
  // readdir, which returns ENOTDIR. Normalize both contracts here.
  const rootIsFile =
    entries.length === 1 &&
    !entries[0].isFolder &&
    path.normalize(entries[0].path) === path.normalize(root);
  if (rootIsFile) {
    if (side === 'source') return null;
    throw new Error(`Destination is a file, not a directory: ${root}`);
  }
  return entries;
}

export const computeSmartSyncDiff = ({
  sourceFiles,
  destFiles,
  sourceRoot,
  destRoot,
}) => {
  const filesToTransfer = [];
  const extrasInDest = [];
  let newFiles = 0;
  let modifiedFiles = 0;
  let unchangedSkipped = 0;

  // Build map of dest files keyed by lowercase relative path
  const destMap = new Map();

  for (const file of destFiles) {
    if (!file.isFolder) {
      const relPath = path.relative(destRoot, file.path).toLowerCase();

      destMap.set(relPath, file);
    }
  }

  // Compare source files against dest
  for (const file of sourceFiles) {
    if (!file.isFolder) {
      const relPath = path.relative(sourceRoot, file.path);
      const relPathKey = relPath.toLowerCase();
      const destFile = destMap.get(relPathKey);

      if (!destFile) {
        // New file - not in destination
        filesToTransfer.push(file);
        newFiles += 1;
      } else {
        const sourceDate =
          typeof file.mtimeMs === 'number'
            ? file.mtimeMs
            : new Date(file.dateAdded).getTime();
        const destDate =
          typeof destFile.mtimeMs === 'number'
            ? destFile.mtimeMs
            : new Date(destFile.dateAdded).getTime();
        const sizeDiffers = file.size !== destFile.size;
        // MTP timestamps have second precision. Compare at that resolution
        // when either listing lacks mtimeMs, so a round trip is idempotent.
        const precise =
          typeof file.mtimeMs === 'number' &&
          typeof destFile.mtimeMs === 'number';
        const sourceNewer = precise
          ? sourceDate > destDate
          : Math.floor(sourceDate / 1000) > Math.floor(destDate / 1000);

        if (sizeDiffers || sourceNewer) {
          // Modified file
          filesToTransfer.push(file);
          modifiedFiles += 1;
        } else {
          // Unchanged - skip
          unchangedSkipped += 1;
        }

        // Remove from dest map so we can find extras
        destMap.delete(relPathKey);
      }
    }
  }

  // Remaining dest files are extras
  for (const [, file] of destMap) {
    extrasInDest.push(file);
  }

  return {
    filesToTransfer,
    extrasInDest,
    summary: {
      newFiles,
      modifiedFiles,
      unchangedSkipped,
      extrasCount: extrasInDest.length,
    },
  };
};

export const groupFilesByParentDir = ({
  filesToTransfer,
  sourceRoot,
  destRoot,
}) => {
  const batchMap = new Map();

  for (const file of filesToTransfer) {
    const relPath = path.relative(sourceRoot, file.path);
    const relDir = path.dirname(relPath);

    if (!batchMap.has(relDir)) {
      batchMap.set(relDir, {
        sourceDir: path.join(sourceRoot, relDir),
        destDir: path.join(destRoot, relDir),
        files: [],
      });
    }

    batchMap.get(relDir).files.push(file.path);
  }

  return Array.from(batchMap.values());
};
