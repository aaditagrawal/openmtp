import path from 'path';
import { rename as fsRename, rm, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { isMacOSVersionGreaterThanOrEqualTo } from 'macos-version';
import { log } from '../../../utils/log';
import { isArray, isEmpty, undefinedOrNull } from '../../../utils/funcs';
import { pathUp } from '../../../utils/files';
import { appDateFormat } from '../../../utils/date';
import { checkIf } from '../../../utils/checkIf';
import { PATHS } from '../../../constants/paths';
import { NODE_MAC_PERMISSIONS_MIN_OS } from '../../../constants';
import {
  readDirectoryEntries,
  readDirectoryTree,
} from '../../../utils/localDirectory';

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
      isMacOSVersionGreaterThanOrEqualTo(NODE_MAC_PERMISSIONS_MIN_OS);

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

  async _list({ filePath, ignoreHidden }, recursive) {
    try {
      if (!(await this._requestUsageAccess({ filePath }))) {
        return { data: null, error: 'Permission denied' };
      }
      const read = recursive ? readDirectoryTree : readDirectoryEntries;
      const entries = await read(filePath, { ignoreHidden });
      return {
        error: null,
        data: entries.map((entry) => ({
          ...entry,
          dateAdded: appDateFormat(new Date(entry.mtimeMs)),
        })),
      };
    } catch (error) {
      log.error(error, 'FileExplorerLocalDataSource.listFiles');
      return {
        error: error.code === 'ENOTDIR' ? 'ENOTDIR' : error,
        data: null,
      };
    }
  }

  listFiles(options) {
    return this._list(options, false);
  }

  listFilesRecursive(options) {
    return this._list(options, true);
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
