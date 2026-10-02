import fs from 'node:fs';
import path from 'node:path';

export function resolveRuntimePaths({
  electronVersion = process.versions.electron,
  resourcesPath = process.resourcesPath,
  startDirectory = __dirname,
} = {}) {
  const packaged = Boolean(
    electronVersion &&
    resourcesPath &&
    fs.existsSync(path.join(resourcesPath, 'app.asar')),
  );
  // Native binaries live outside ASAR, in OpenMTP.app/Contents/Resources/bin.
  if (packaged)
    return {
      isPackaged: true,
      rootPath: path.resolve(resourcesPath, '..', '..'),
    };

  let directory = path.resolve(startDirectory);
  while (true) {
    if (fs.existsSync(path.join(directory, 'package.json'))) {
      return { isPackaged: false, rootPath: directory };
    }
    const parent = path.dirname(directory);
    if (parent === directory)
      throw new Error('Cannot locate the OpenMTP package root');
    directory = parent;
  }
}

export const { isPackaged, rootPath } = resolveRuntimePaths();
