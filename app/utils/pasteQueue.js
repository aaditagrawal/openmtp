import { baseName, sanitizePath } from './files';

/**
 * Drop clipboard sources whose destination already exists.
 * Destination path is `${destinationFolder}/${basename(source)}`.
 */
export const filterPasteQueueSkippingExisting = ({
  queue = [],
  destinationFolder,
  existingPaths = [],
}) => {
  const existingSet = new Set(existingPaths || []);
  const destRoot = sanitizePath((destinationFolder || '').replace(/\/$/, ''));

  return (queue || []).filter((sourcePath) => {
    const name = baseName(sourcePath);

    if (!name) {
      return false;
    }

    const destPath = sanitizePath(`${destRoot}/${name}`);

    return !existingSet.has(destPath);
  });
};
