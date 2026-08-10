import path from 'path';

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
        const sourceNewer = sourceDate > destDate;

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
