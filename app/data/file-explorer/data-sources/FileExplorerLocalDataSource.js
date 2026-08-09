import path from 'path';
import { promisify } from 'node:util';
import junk from 'junk';
import macosVersion from 'macos-version';
import {
  readdir as fsReaddir,
  existsSync,
  statSync,
  lstatSync,
  rename as fsRename,
  readlinkSync,
  realpathSync,
  rm,
} from 'fs';
import { log } from '../../../utils/log';
import { isArray, isEmpty, undefinedOrNull } from '../../../utils/funcs';
import { pathUp } from '../../../utils/files';
import { appDateFormat } from '../../../utils/date';
import { checkIf } from '../../../utils/checkIf';
import { PATHS } from '../../../constants/paths';
import { NODE_MAC_PERMISSIONS_MIN_OS } from '../../../constants';

export class FileExplorerLocalDataSource {
  constructor() {
    this.readdir = promisify(fsReaddir);
  }

  /**
   * description - make directory helper
   *
   */
  async _mkdir({ filePath }) {
    try {
      return new Promise((resolve) => {
        mkdir(filePath, { recursive: true }, (error) => {
          if (error) {
            resolve({ data: null, stderr: error, error });
            return;
          }

          resolve({ data: filePath, stderr: null, error: null });
        });
      });
    } catch (e) {
      log.error(e);
    }
  }

  /**
   * description - Rename file helper
   *
   */
  _rename({ filePath, newFilename }) {
    try {
      const parentDir = pathUp(filePath);
      const newFilePath = path.join(parentDir, newFilename);

      return new Promise((resolve) => {
        fsRename(filePath, newFilePath, (error) => {
          return resolve({
            data: null,
            stderr: error,
            error,
          });
        });
      });
    } catch (e) {
      log.error(e);

      return {
        data: null,
        stderr: null,
        error: e,
      };
    }
  }

  /**
   * description - Delete file helper
   *
   */
  _delete = (file) => {
    try {
      return new Promise((resolve) => {
        rm(file, { recursive: true, force: true }, (error) => {
          resolve({
            data: null,
            stderr: error,
            error,
          });
        });
      });
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
   * @private
   *
   * @param fullPath
   * @returns {{isFolder: boolean, symlink: string|null}}
   * @private
   */
  _getSymlinkInfo = ({ fullPath }) => {
    try {
      const lstat = lstatSync(fullPath);

      if (!lstat.isSymbolicLink()) {
        return {
          isFolder: lstat.isDirectory(),
          symlink: null,
        };
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

      const response = [];
      const { error, data } = await this.readdir(filePath, 'utf8')
        .then((res) => {
          return {
            data: res,
            error: null,
          };
        })
        .catch((e) => {
          return {
            data: null,
            error: e,
          };
        });

      if (error) {
        log.error(error, `FileExplorerLocalDataSource.listFiles`);

        return { error, data: null };
      }

      let files = data;

      files = data.filter(junk.not);
      if (ignoreHidden) {
        // oxlint-disable-next-line no-useless-escape
        files = data.filter((item) => !/(^|\/)\.[^\/\.]/g.test(item));
      }

      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];

        const fullPath = path.resolve(filePath, file);

        if (!existsSync(fullPath)) {
          continue; // oxlint-disable-line no-continue
        }

        const { isFolder, symlink } = this._getSymlinkInfo({
          fullPath,
        });

        const stat = statSync(fullPath);
        const extension = path.extname(fullPath);
        const { size, atime: dateTime } = stat;

        if (response.find((item) => item.path === fullPath)) {
          continue; // oxlint-disable-line no-continue
        }

        response.push({
          name: file,
          path: fullPath,
          extension,
          size,
          isFolder,
          dateAdded: appDateFormat(dateTime),
          symlink,
        });
      }

      return { error, data: response };
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

      while (queue.length > 0) {
        const currentDir = queue.shift();

        try {
          // Directory traversal is intentionally sequential so nested folders are
          // appended to the same breadth-first queue in a predictable order.
          // oxlint-disable-next-line no-await-in-loop
          const dirEntries = await this.readdir(currentDir, 'utf8');
          let files = dirEntries.filter(junk.not);

          if (ignoreHidden) {
            // oxlint-disable-next-line no-useless-escape
            files = files.filter((item) => !/(^|\/)\.[^\/\.]/g.test(item));
          }

          const fileDetails = files.map((file) => {
            const fullPath = path.resolve(currentDir, file);

            if (!existsSync(fullPath)) {
              return null;
            }

            const { isFolder, symlink } = this._getSymlinkInfo({
              fullPath,
            });

            const stat = statSync(fullPath);
            const extension = path.extname(fullPath);
            // Use mtime (modification time) so Smart Sync's diff can
            // reliably detect when the source is newer than destination.
            // atime (access time) updates on read and is unreliable for
            // "is this file newer?" comparisons.
            const { size, mtime: dateTime } = stat;

            return {
              file,
              fullPath,
              extension,
              size,
              isFolder,
              dateAdded: appDateFormat(dateTime),
              symlink,
            };
          });

          fileDetails.filter(Boolean).forEach((fileDetail) => {
            if (fileDetail.isFolder) {
              queue.push(fileDetail.fullPath);

              return;
            }

            response.push({
              name: fileDetail.file,
              path: fileDetail.fullPath,
              extension: fileDetail.extension,
              size: fileDetail.size,
              isFolder: fileDetail.isFolder,
              dateAdded: fileDetail.dateAdded,
              symlink: fileDetail.symlink,
            });
          });
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

      // oxlint-disable-next-line no-await-in-loop
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

        // oxlint-disable-next-line no-await-in-loop
        const _accessGranted = await this._requestUsageAccess({
          filePath: fullPath,
        });

        if (!_accessGranted) {
          // Fail closed so the conflict dialog is shown instead of overwriting.
          return [...fileList];
        }

        // oxlint-disable-next-line no-await-in-loop
        if (await existsSync(fullPath)) {
          existing.push(item);
        }
      }

      return existing;
    } catch (e) {
      log.error(e);

      return [...fileList];
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
