/* eslint no-await-in-loop: off */

/**
 * Boot
 * Note: Don't import log helper file from utils here
 */

import { readdirSync, promises as fs } from 'fs';
import { PATHS } from '../constants/paths';
import {
  fileExistsSync,
  createDirSync,
  deleteFilesSync,
} from '../helpers/fileOps';
import { dateNow, daysDiff } from '../utils/date';
import { LOG_FILE_ROTATION_CLEANUP_THRESHOLD } from '../constants';
import { baseName } from '../utils/files';

const { logFile, settingsFile, logDir } = PATHS;
const logFileRotationCleanUpThreshold = LOG_FILE_ROTATION_CLEANUP_THRESHOLD;

export default class Boot {
  constructor() {
    this.verifyDirList = [logDir];
    this.verifyFileList = [logFile, settingsFile];
    this.settingsFile = settingsFile;
  }

  async init() {
    try {
      for (let i = 0; i < this.verifyDirList.length; i += 1) {
        const item = this.verifyDirList[i];

        if (!(await this.verifyDir(item))) {
          await this.createDir(item);
        }
      }

      if (!this.verifyFile(this.settingsFile)) {
        await this.createFile(this.settingsFile);
      }

      for (let i = 0; i < this.verifyFileList.length; i += 1) {
        const item = this.verifyFileList[i];

        if (!this.verifyFile(item)) {
          await this.createFile(item);
        }
      }

      return true;
    } catch (e) {
      console.error(e);
    }
  }

  async verify() {
    try {
      for (let i = 0; i < this.verifyDirList.length; i += 1) {
        const item = this.verifyDirList[i];

        if (!(await this.verifyDir(item))) {
          return false;
        }
      }

      for (let i = 0; i < this.verifyFileList.length; i += 1) {
        const item = this.verifyFileList[i];

        if (!this.verifyFile(item)) {
          return false;
        }
      }

      return true;
    } catch (e) {
      console.error(e);
    }
  }

  quickVerify() {
    try {
      for (let i = 0; i < this.verifyFileList.length; i += 1) {
        const item = this.verifyFileList[i];

        if (!this.verifyFile(item)) {
          return false;
        }
      }
      return true;
    } catch (e) {
      console.error(e);
    }
  }

  async verifyDir(filePath) {
    try {
      return fileExistsSync(filePath);
    } catch (e) {
      console.error(e);
    }
  }

  async createDir(newFolderPath) {
    try {
      await createDirSync(newFolderPath);
    } catch (e) {
      console.error(e);
    }
  }

  verifyFile(filePath) {
    try {
      return fileExistsSync(filePath);
    } catch (e) {
      console.error(e);
    }
  }

  async createFile(filePath) {
    // Exclusive creation cannot truncate settings created by another process.
    try {
      await fs.writeFile(filePath, filePath === this.settingsFile ? '{}' : '', {
        flag: 'wx',
        mode: 0o600,
      });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }

  cleanRotationFiles() {
    try {
      const dirFileList = readdirSync(logDir);
      const pattern = `^\\${baseName(logFile)}`;
      const _regex = new RegExp(pattern, 'gi');
      const filesList = dirFileList.filter((elm) => {
        return !elm.match(_regex);
      });

      if (filesList === null || filesList.length < 1) {
        return null;
      }

      filesList.map(async (a) => {
        const dateMatch = a.match(/\d{4}-\d{2}/g);

        if (
          dateMatch === null ||
          dateMatch.length < 1 ||
          typeof dateMatch[0] === 'undefined' ||
          dateMatch[0] === null
        ) {
          return null;
        }

        const _diff = daysDiff(dateNow({}), dateMatch[0]);

        if (_diff >= logFileRotationCleanUpThreshold) {
          deleteFilesSync(`${logDir}/${a}`);
        }
      });
    } catch (e) {
      console.error(e);
    }
  }
}
