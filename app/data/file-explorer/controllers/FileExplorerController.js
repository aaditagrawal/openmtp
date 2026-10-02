import { FileExplorerLegacyDataSource } from '../data-sources/FileExplorerLegacyDataSource';
import { FileExplorerLocalDataSource } from '../data-sources/FileExplorerLocalDataSource';
import { FileExplorerKalamDataSource } from '../data-sources/FileExplorerKalamDataSource';
import { checkIf } from '../../../utils/checkIf';
import { analyticsService } from '../../../services/analytics';
import { EVENT_TYPE } from '../../../enums/events';
import {
  processLocalBuffer,
  processMtpBuffer,
} from '../../../helpers/processBufferOutput';
import { getMtpModeSetting } from '../../../helpers/settings';
import { DEVICE_TYPE, MTP_MODE } from '../../../enums';
import { unixTimestampNow } from '../../../utils/date';

export class FileExplorerController {
  constructor({
    local = new FileExplorerLocalDataSource(),
    legacy = new FileExplorerLegacyDataSource(),
    kalam = new FileExplorerKalamDataSource(),
    getMtpMode = () => getMtpModeSetting(),
  } = {}) {
    this.backends = { local, legacy, kalam };
    this.getMtpMode = getMtpMode;
  }

  _execute(operation, { deviceType, ...args }) {
    const mtpOnly = [
      'initialize',
      'dispose',
      'listStorages',
      'transferFiles',
      'fetchDebugReport',
    ];
    if (deviceType !== DEVICE_TYPE.mtp) {
      if (mtpOnly.includes(operation)) {
        throw `${operation} for deviceType=DEVICE_TYPE.local is unimplemented`;
      }
      const { storageId: _storageId, ...localArgs } = args;
      return this.backends.local[operation](localArgs);
    }

    const legacy = this.getMtpMode() === MTP_MODE.legacy;
    if (legacy && operation === 'initialize') {
      throw 'initialize for MTP_MODE.legacy is unimplemented';
    }
    if (legacy && operation === 'dispose') return undefined;
    if (!mtpOnly.includes(operation) || operation === 'transferFiles') {
      checkIf(args.storageId, 'number');
    }
    const backend = legacy ? this.backends.legacy : this.backends.kalam;
    const method =
      legacy && operation === 'listFilesRecursive' ? 'listFiles' : operation;
    if (operation === 'transferFiles' && !legacy) args.deviceType = deviceType;
    return backend[method](args);
  }

  async _sentEvent({ result, deviceType, eventKey, attachData = false }) {
    const local = deviceType === DEVICE_TYPE.local;
    const mtpMode = local ? undefined : this.getMtpMode();
    const input = { error: result?.error, stderr: result?.stderr, mtpMode };
    const { error, mtpStatus } = await (local
      ? processLocalBuffer(input)
      : processMtpBuffer(input));
    const key =
      EVENT_TYPE[
        `${local ? 'LOCAL' : 'MTP'}_${eventKey}_${error ? 'ERROR' : 'SUCCESS'}`
      ];
    if (!key) return;
    await analyticsService.sendEvent(key, {
      time: unixTimestampNow(),
      ...(!local && { 'MTP Status': mtpStatus, 'MTP Mode': mtpMode }),
      ...(error
        ? { stderr: result?.stderr, error: result?.error }
        : attachData && { data: result?.data }),
    });
  }

  async initialize({ deviceType }) {
    checkIf(deviceType, 'string');

    const result = await this._execute('initialize', { deviceType });

    this._sentEvent({ result, deviceType, eventKey: 'INITIALIZE' });

    return result;
  }

  async dispose({ deviceType }) {
    checkIf(deviceType, 'string');

    const result = await this._execute('dispose', { deviceType });

    this._sentEvent({ result, deviceType, eventKey: 'DISPOSE' });

    return result;
  }

  async listStorages({ deviceType }) {
    checkIf(deviceType, 'string');

    const result = await this._execute('listStorages', { deviceType });

    this._sentEvent({
      result,
      deviceType,
      eventKey: 'LIST_STORAGES',
      attachData: true,
    });

    return result;
  }

  async listFiles({ deviceType, filePath, ignoreHidden, storageId }) {
    checkIf(deviceType, 'string');
    checkIf(filePath, 'string');
    checkIf(ignoreHidden, 'boolean');

    const result = await this._execute('listFiles', {
      deviceType,
      filePath,
      ignoreHidden,
      storageId,
    });

    // Folder open is a hot path — only pay analytics/buffer work on errors.
    if (result?.error || result?.stderr) {
      this._sentEvent({ result, deviceType, eventKey: 'LIST_FILES' });
    }

    return result;
  }

  async listFilesRecursive({ deviceType, filePath, ignoreHidden, storageId }) {
    checkIf(deviceType, 'string');
    checkIf(filePath, 'string');
    checkIf(ignoreHidden, 'boolean');

    const result = await this._execute('listFilesRecursive', {
      deviceType,
      filePath,
      ignoreHidden,
      storageId,
    });

    if (result?.error || result?.stderr) {
      this._sentEvent({ result, deviceType, eventKey: 'LIST_FILES' });
    }

    return result;
  }

  async renameFile({ deviceType, filePath, newFilename, storageId }) {
    checkIf(deviceType, 'string');
    checkIf(filePath, 'string');
    checkIf(newFilename, 'string');

    const result = await this._execute('renameFile', {
      deviceType,
      filePath,
      newFilename,
      storageId,
    });

    this._sentEvent({ result, deviceType, eventKey: 'RENAME_FILE' });

    return result;
  }

  async deleteFiles({ deviceType, fileList, storageId }) {
    checkIf(deviceType, 'string');
    checkIf(fileList, 'array');

    const result = await this._execute('deleteFiles', {
      deviceType,
      fileList,
      storageId,
    });

    this._sentEvent({ result, deviceType, eventKey: 'DELETE_FILE' });

    return result;
  }

  async makeDirectory({ deviceType, filePath, storageId }) {
    checkIf(deviceType, 'string');
    checkIf(filePath, 'string');

    const result = await this._execute('makeDirectory', {
      deviceType,
      filePath,
      storageId,
    });

    this._sentEvent({ result, deviceType, eventKey: 'NEW_FOLDER' });

    return result;
  }

  async listExistingFiles({ deviceType, fileList, storageId }) {
    checkIf(deviceType, 'string');
    checkIf(fileList, 'array');

    const result = await this._execute('listExistingFiles', {
      deviceType,
      fileList,
      storageId,
    });

    this._sentEvent({ result, deviceType, eventKey: 'FILES_EXIST' });

    return Array.isArray(result) ? result : [];
  }

  async filesExist({ deviceType, fileList, storageId }) {
    checkIf(deviceType, 'string');
    checkIf(fileList, 'array');

    const result = await this._execute('filesExist', {
      deviceType,
      fileList,
      storageId,
    });

    this._sentEvent({ result, deviceType, eventKey: 'FILES_EXIST' });

    return result;
  }

  transferFiles = async ({
    deviceType,
    destination,
    fileList,
    direction,
    storageId,
    onError,
    onPreprocess,
    onProgress,
    onCompleted,
  }) => {
    checkIf(deviceType, 'string');
    checkIf(destination, 'string');
    checkIf(direction, 'string');
    checkIf(fileList, 'array');
    checkIf(onError, 'function');
    checkIf(onPreprocess, 'function');
    checkIf(onProgress, 'function');
    checkIf(onCompleted, 'function');

    const result = await this._execute('transferFiles', {
      deviceType,
      destination,
      fileList,
      direction,
      storageId,
      onError,
      onProgress,
      onCompleted,
      onPreprocess,
    });

    this._sentEvent({ result, deviceType, eventKey: 'TRANSFER_FILES' });

    return result;
  };

  async fetchDebugReport({ deviceType }) {
    checkIf(deviceType, 'string');

    const result = await this._execute('fetchDebugReport', { deviceType });

    this._sentEvent({ result, deviceType, eventKey: 'FETCH_DEBUG_REPORT' });

    return result;
  }
}

const fileExplorerController = new FileExplorerController();

export default fileExplorerController;
