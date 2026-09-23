import path from 'path';
import { readdir, rename as fsRename, rm, mkdir } from 'fs/promises';
import {
  existsSync,
  statSync,
  lstatSync,
  readlinkSync,
  realpathSync,
} from 'fs';
import macosVersion from 'macos-version';
import { log } from '../../../utils/log';
import { isArray, isEmpty, undefinedOrNull } from '../../../utils/funcs';
import { pathUp } from '../../../utils/files';
import { appDateFormat } from '../../../utils/date';
import { checkIf } from '../../../utils/checkIf';
import { PATHS } from '../../../constants/paths';
import { NODE_MAC_PERMISSIONS_MIN_OS } from '../../../constants';
import { filterDirents } from '../../../utils/dirListing';

export class FileExplorerLocalDataSource {
  /**
   * description - make directory helper
   *
   */
  async _mkdir({ filePath }) {
    try {
      await mkdir(filePath, { recursive: true });

      return { data: filePath, stderr: null, error: null };
    } catch (error) {
      return { data: null, stderr: error, error };
    }
  }

  /**
   * description - Rename file helper
   *
   */
  async _rename({ filePath, newFilename }) {
    try {
      const parentDir = pathUp(filePath);
      const newFilePath = path.join(parentDir, newFilename);

      await fsRename(filePath, newFilePath);

      return {
        data: null,
        stderr: null,
        error: null,
      };
    } catch (e) {
      return {
        data: null,
        stderr: e,
        error: e,
      };
    }
  }

  /**
   * description - Delete file helper
   *
   */
  _delete = async (file) => {
    try {
      await rm(file, { recursive: true, force: true });

      return {
        data: null,
        stderr: null,
        error: null,
      };
    } catch (e) {
      log.error(e);

      return { error: e, stderr: null, data: false };
    }
  };

  /**
   * description - request the usage access of the protected directories in macos
   * @private
   *
   * @param filePath {string}
   * @return {Promise<boolean>}
   */
  _requestUsageAccess = async ({ filePath }) => {
    const doesCurrentOsSupportNodeMacPermission =
      macosVersion.isGreaterThanOrEqualTo(NODE_MAC_PERMISSIONS_MIN_OS);

    if (!doesCurrentOsSupportNodeMacPermission) {
      return true;
    }

    const { askForFoldersAccess, askForPhotosAccess } = await import(
      // eslint-disable-next-line import/no-unresolved
      'node-mac-permissions'
    );

    checkIf(filePath, 'string');

    const isGrantedString = 'authorized';

    let result;

    if (filePath.startsWith(PATHS.desktopDir)) {
      result = await askForFoldersAccess('desktop');
    } else if (filePath.startsWith(PATHS.downloadsDir)) {
      result = await askForFoldersAccess('downloads');
    } else if (filePath.startsWith(PATHS.documentsDir)) {
      result = await askForFoldersAccess('documents');
    } else if (filePath.startsWith(PATHS.picturesDir)) {
      result = await askForPhotosAccess();
    }

    if (undefinedOrNull(result)) {
      return true;
    }

    return result === isGrantedString;
  };

  /**
   *
   * description - returns file info needed for navigating through symlinks.
   * Synchronous on purpose: listDirectory is on the open-folder hot path
   * (double-click / Enter) and awaiting readlink per entry made navigation
   * feel lagged even for ordinary non-symlink directories.
   * When `dirent` is provided and is not a symlink, skip lstat entirely.
   * @private
   *
   * @param fullPath
   * @param dirent
   * @returns {{isFolder: boolean, symlink: string|null}}
   * @private
   */
  _getSymlinkInfo = ({ fullPath, dirent = null }) => {
    try {
      // Dirent already answered "not a symlink" — skip lstat on the hot path.
      if (dirent && !dirent.isSymbolicLink()) {
        return {
          isFolder: dirent.isDirectory(),
          symlink: null,
        };
      }

      if (!dirent) {
        const lstat = lstatSync(fullPath);

        if (!lstat.isSymbolicLink()) {
          return {
            isFolder: lstat.isDirectory(),
            symlink: null,
          };
        }
      }

      let symlink = null;

      try {
        const lnk = readlinkSync(fullPath);

        if (!undefinedOrNull(lnk) && existsSync(lnk)) {
          symlink = realpathSync(lnk);
        }
      } catch (_) {
        symlink = null;
      }

      return {
        isFolder: lstatSync(symlink ?? fullPath).isDirectory(),
        symlink,
      };
    } catch (_) {
      return {
        isFolder: false,
        symlink: null,
      };
    }
  };

  /**
   * Build one list entry from a dirent. Returns null if the path raced away.
   * @private
   */
  _buildListEntry = ({ file, fullPath, dirent, dateField = 'mtime' }) => {
    const { isFolder, symlink } = this._getSymlinkInfo({
      fullPath,
      dirent,
    });

    let stat;

    try {
      // One stat for size/date; replaces the old existsSync + separate statSync.
      stat = statSync(fullPath);
    } catch (_) {
      return null;
    }

    const extension = path.extname(fullPath);
    const size = stat.size;
    const dateTime = dateField === 'atime' ? stat.atime : stat.mtime;

    return {
      name: file,
      path: fullPath,
      extension,
      size,
      isFolder,
      dateAdded: appDateFormat(dateTime),
      mtimeMs: dateTime.getTime(),
      symlink,
    };
  };

  /**
   * description - Fetch local files in the path
   *
   * @param filePath
   * @param ignoreHidden
   * @return {Promise<{data: array|null, error: string|null, stderr: string|null}>}
   */
  async listFiles({ filePath, ignoreHidden }) {
    try {
      const _accessGranted = await this._requestUsageAccess({ filePath });

      if (!_accessGranted) {
        return {
          data: null,
          error: 'Permission denied',
        };
      }

      let dirents;

      try {
        dirents = await readdir(filePath, { withFileTypes: true });
      } catch (error) {
        log.error(error, `FileExplorerLocalDataSource.listFiles`);

        return { error, data: null };
      }

      const files = filterDirents(dirents, { ignoreHidden });
      const response = [];
      const seenPaths = new Set();

      for (let i = 0; i < files.length; i += 1) {
        const dirent = files[i];
        const fullPath = path.resolve(filePath, dirent.name);

        if (seenPaths.has(fullPath)) {
          continue; // oxlint-disable-line no-continue
        }

        const entry = this._buildListEntry({
          file: dirent.name,
          fullPath,
          dirent,
          dateField: 'mtime',
        });

        if (!entry) {
          continue; // oxlint-disable-line no-continue
        }

        seenPaths.add(fullPath);
        response.push(entry);
      }

      return { error: null, data: response };
    } catch (e) {
      log.error(e);

      return { error: e, data: null };
    }
  }

  async listFilesRecursive({ filePath, ignoreHidden }) {
    try {
      const _accessGranted = await this._requestUsageAccess({ filePath });

      if (!_accessGranted) {
        return {
          data: null,
          error: 'Permission denied',
        };
      }

      // Smart Sync calls this for every selected path. A file path must not
      // be treated as an empty directory (that made Sync skip the file).
      if (!existsSync(filePath)) {
        return { error: `Path not found: ${filePath}`, data: null };
      }

      const rootStat = this._getSymlinkInfo({ fullPath: filePath });

      if (!rootStat.isFolder) {
        return { error: 'ENOTDIR', data: null };
      }

      const response = [];
      const queue = [filePath];
      let queueIndex = 0;

      while (queueIndex < queue.length) {
        const currentDir = queue[queueIndex];

        queueIndex += 1;

        try {
          // Directory traversal is intentionally sequential so nested folders are
          // appended to the same breadth-first queue in a predictable order.
          // oxlint-disable-next-line no-await-in-loop
          const dirents = await readdir(currentDir, { withFileTypes: true });
          const files = filterDirents(dirents, { ignoreHidden });

          for (let i = 0; i < files.length; i += 1) {
            const dirent = files[i];
            const fullPath = path.resolve(currentDir, dirent.name);
            const entry = this._buildListEntry({
              file: dirent.name,
              fullPath,
              dirent,
              // Use mtime (modification time) so Smart Sync's diff can
              // reliably detect when the source is newer than destination.
              // atime (access time) updates on read and is unreliable for
              // "is this file newer?" comparisons.
              dateField: 'mtime',
            });

            if (!entry) {
              continue; // oxlint-disable-line no-continue
            }

            if (entry.isFolder) {
              queue.push(entry.path);

              continue; // oxlint-disable-line no-continue
            }

            response.push(entry);
          }
        } catch (error) {
          log.error(error, `FileExplorerLocalDataSource.listFilesRecursive`);
        }
      }

      return { error: null, data: response };
    } catch (e) {
      log.error(e);

      return { error: e, data: null };
    }
  }

  /**
   * description - Rename a local file
   *
   * @param filePath
   * @param newFilename
   * @return {Promise<{data: null|boolean, error: string|null, stderr: string|null}>}
   */
  async renameFile({ filePath, newFilename }) {
    try {
      if (undefinedOrNull(filePath) || undefinedOrNull(newFilename)) {
        return { error: `No files selected.`, stderr: null, data: null };
      }

      const _accessGranted = await this._requestUsageAccess({ filePath });

      if (!_accessGranted) {
        return {
          data: null,
          error: 'Permission denied',
        };
      }

      const { error } = await this._rename({ filePath, newFilename });

      if (error) {
        log.error(
          `${error}`,
          `FileExplorerLocalDataSource.renameFile -> mv error`,
        );

        return { error, stderr: null, data: false };
      }

      return { error: null, stderr: null, data: true };
    } catch (e) {
      log.error(e);

      return { error: e, stderr: null, data: false };
    }
  }

  /**
   * description - Delete a local file
   *
   * @param fileList
   * @return {Promise<{data: null|boolean, error: string|null, stderr: string|null}>}
   */
  async deleteFiles({ fileList }) {
    try {
      if (!fileList || fileList.length < 1) {
        return { error: `No files selected.`, stderr: null, data: null };
      }

      for (let i = 0; i < fileList.length; i += 1) {
        const filePath = fileList[i];

        // oxlint-disable-next-line no-await-in-loop
        const _accessGranted = await this._requestUsageAccess({ filePath });

        if (!_accessGranted) {
          return {
            data: null,
            error: 'Permission denied',
          };
        }

        // oxlint-disable-next-line no-await-in-loop
        const { error } = await this._delete(filePath);

        if (error) {
          log.error(
            `${error}`,
            `FileExplorerLocalDataSource.deleteFiles -> rm error`,
          );

          return { error, stderr: null, data: false };
        }
      }

      return { error: null, stderr: null, data: true };
    } catch (e) {
      log.error(e);

      return { error: e, stderr: null, data: false };
    }
  }

  /**
   * description - Create a local directory
   *
   * @param {string} filePath
   * @return {Promise<{data: null|boolean, error: string|null, stderr: string|null}>}
   */
  async makeDirectory({ filePath }) {
    try {
      if (undefinedOrNull(filePath)) {
        return { error: `Invalid path.`, stderr: null, data: null };
      }

      const _accessGranted = await this._requestUsageAccess({
        filePath,
      });

      if (!_accessGranted) {
        return {
          data: null,
          error: 'Permission denied',
        };
      }

      const { error } = await this._mkdir({ filePath });

      if (error) {
        log.error(
          `${error}`,
          `FileExplorerLocalDataSource.makeDirectory -> mkdir error`,
        );

        return { error, stderr: null, data: false };
      }

      return { error: null, stderr: null, data: true };
    } catch (e) {
      log.error(e);

      return { error: e, stderr: null, data: false };
    }
  }

  /**
   * description - Return local paths that already exist
   *
   * @param {[string]} fileList
   * @return {Promise<string[]>}
   */
  async listExistingFiles({ fileList }) {
    try {
      if (!isArray(fileList) || isEmpty(fileList)) {
        return [];
      }

      const existing = [];

      for (let i = 0; i < fileList.length; i += 1) {
        const item = fileList[i];
        const fullPath = path.resolve(item);

        // Permission prompts stay sequential (macOS TCC dialogs).
        // oxlint-disable-next-line no-await-in-loop
        const _accessGranted = await this._requestUsageAccess({
          filePath: fullPath,
        });

        if (!_accessGranted) {
          // Fail closed so the conflict dialog is shown instead of overwriting.
          return fileList.slice();
        }

        if (existsSync(fullPath)) {
          existing.push(item);
        }
      }

      return existing;
    } catch (e) {
      log.error(e);

      return fileList.slice();
    }
  }

  /**
   * description - Check if files exist in the local disk
   *
   * @param {[string]} fileList
   * @return {Promise<boolean>}
   */
  async filesExist({ fileList }) {
    const existing = await this.listExistingFiles({ fileList });

    return existing.length > 0;
  }
}
