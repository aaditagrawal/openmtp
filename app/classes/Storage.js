import {
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  copyFileSync,
  mkdirSync,
  constants,
} from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';

// Storage is used by the logger itself. Never route storage failures through log.
export default class Storage {
  constructor(filePath, doNotLog = false) {
    this.filePath = filePath;
    this.doNotLog = doNotLog;
  }

  getAll() {
    try {
      const contents = readFileSync(this.filePath, 'utf8');
      if (!contents.trim()) return {};
      const parsed = JSON.parse(contents);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new SyntaxError('Settings must contain a JSON object');
      }
      return parsed;
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      if (error instanceof SyntaxError) {
        // Preserve the damaged file before a later settings update replaces it.
        try {
          copyFileSync(
            this.filePath,
            this.filePath + '.corrupt-backup',
            constants.COPYFILE_EXCL,
          );
        } catch (backupError) {
          if (backupError.code !== 'EEXIST')
            console.error(backupError, 'Storage backup');
        }
      }
      console.error(error, 'Storage -> getAll');
      return {};
    }
  }

  getItems(keys) {
    if (!Array.isArray(keys))
      throw new TypeError('Storage keys must be an array');
    const all = this.getAll();
    return Object.fromEntries(
      keys
        .filter((key) => all[key] !== undefined && all[key] !== null)
        .map((key) => [key, all[key]]),
    );
  }

  writeFromRenderer(method, data) {
    // Main owns read-modify-write operations across all renderer windows.
    const { ipcRenderer } = require('electron');
    const result = ipcRenderer.sendSync('openmtp.storage-update', {
      filePath: this.filePath,
      method,
      data,
    });
    if (!result?.ok)
      console.error(result?.error || 'Profile update failed', 'Storage IPC');
    return result?.ok === true;
  }

  setAll(data) {
    if (process.type === 'renderer')
      return this.writeFromRenderer('setAll', data);
    const temporaryPath =
      this.filePath + '.' + process.pid + '.' + randomUUID() + '.tmp';
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(temporaryPath, JSON.stringify({ ...data }), {
        mode: 0o600,
        flag: 'wx',
      });
      renameSync(temporaryPath, this.filePath);
      return true;
    } catch (error) {
      console.error(error, 'Storage -> setAll');
      return false;
    } finally {
      try {
        unlinkSync(temporaryPath);
      } catch (error) {
        if (error.code !== 'ENOENT') console.error(error, 'Storage cleanup');
      }
    }
  }

  setItems(data) {
    if (process.type === 'renderer')
      return this.writeFromRenderer('setItems', data);
    return this.setAll({ ...this.getAll(), ...data });
  }
}
