/* oxlint-disable no-case-declarations */

import { EOL } from 'os';
import { replaceBulk, undefinedOrNull } from '../utils/funcs';
import { log } from '../utils/log';
import {
  formatUsbConflictWarning,
  getActiveUsbConflictApps,
  isGoogleAndroidFileTransferActive,
} from '../utils/usbConflictApps';
import { DEVICES_LABEL } from '../constants';
import { DEVICE_TYPE, MTP_MODE } from '../enums';
import { checkIf } from '../utils/checkIf';
import { MTP_ERROR } from '../enums/mtpError';
import { isNoMtpError } from './mtpErrorDetect';

export { isNoMtpError } from './mtpErrorDetect';

const bufferError = (error, flags = {}) => ({
  error,
  throwAlert: true,
  logError: true,
  ...flags,
});

export const processMtpBuffer = async ({ error, stderr, mtpMode }) => {
  checkIf(mtpMode, 'inObjectValues', MTP_MODE);

  if (mtpMode === MTP_MODE.kalam) {
    const result = await _processKalamMtpBuffer({ error, stderr });
    const noMtpError = isNoMtpError({ error, stderr, mtpMode: MTP_MODE.kalam });

    if (stderr || error) {
      // do not report no mtp error
      if (!noMtpError) {
        log.doLog(
          `MTP buffer o/p logging;${EOL}MTP Mode: ${
            MTP_MODE.kalam
          }${EOL}Raw error: ${(error ?? '').toString()}${EOL}Processed error: ${
            result.error
          }${EOL}Error type: ${stderr ?? ''}`,
          'processKalamMtpBuffer',
          null,
          result.reportError === true,
          // do not report 'device changed' error
          stderr !== MTP_ERROR.ErrorDeviceChanged,
        );
      }
    }

    return result;
  }

  return _processLegacyMtpBuffer({ error, stderr });
};

export const mtpErrors = {
  [MTP_ERROR.ErrorMtpDetectFailed]: `No ${
    DEVICES_LABEL[DEVICE_TYPE.mtp]
  } or MTP device found.`,
  [MTP_ERROR.ErrorDeviceChanged]: null,
  [MTP_ERROR.ErrorMtpLockExists]: `Easy tiger! MTP is not so quick as you are`,
  [MTP_ERROR.ErrorDeviceSetup]: `An error occured while setting up the ${
    DEVICES_LABEL[DEVICE_TYPE.mtp]
  }`,
  [MTP_ERROR.ErrorDeviceLocked]: `Unlock your ${
    DEVICES_LABEL[DEVICE_TYPE.mtp]
  } and refresh again`,
  [MTP_ERROR.ErrorMultipleDevice]: 'Multiple MTP devices found',
  [MTP_ERROR.ErrorAllowStorageAccess]: `Accept MTP access to your ${
    DEVICES_LABEL[DEVICE_TYPE.mtp]
  }'s storage and refresh again`,
  [MTP_ERROR.ErrorDeviceInfo]:
    'An error occured while fetching the device information',
  [MTP_ERROR.ErrorStorageInfo]:
    'An error occured while fetching the storage information',
  [MTP_ERROR.ErrorNoStorage]: `Your ${
    DEVICES_LABEL[DEVICE_TYPE.mtp]
  } storage is inaccessible.`,
  [MTP_ERROR.ErrorStorageFull]: `${
    DEVICES_LABEL[DEVICE_TYPE.mtp]
  } storage is full`,
  [MTP_ERROR.ErrorListDirectory]: `An error occured while listing the ${
    DEVICES_LABEL[DEVICE_TYPE.mtp]
  } directory! Try again.`,
  [MTP_ERROR.ErrorFileNotFound]: 'File not found',
  [MTP_ERROR.ErrorFilePermission]: `Operation not permitted`,
  [MTP_ERROR.ErrorLocalFileRead]: `The file is inaccessible`,
  [MTP_ERROR.ErrorInvalidPath]: 'Invalid path',
  [MTP_ERROR.ErrorFileTransfer]:
    'An error occured while transferring the file! Try again.',
  [MTP_ERROR.ErrorFileObjectRead]:
    'An error occured while reading the MTP file object! Try again.',
  [MTP_ERROR.ErrorSendObject]:
    'An error occured while sending the object! Try again.',
  [MTP_ERROR.ErrorGeneral]: `Oops.. Your ${
    DEVICES_LABEL[DEVICE_TYPE.mtp]
  } has gone crazy! Try again.`,
};

export const _processKalamMtpBuffer = async ({ error, stderr }) => {
  const noMtpError = isNoMtpError({
    error,
    stderr,
    mtpMode: MTP_MODE.kalam,
  });

  let processedErrorValue = null;

  if (!undefinedOrNull(stderr)) {
    processedErrorValue = mtpErrors[stderr];
  }

  if (noMtpError) {
    const conflictApps = await getActiveUsbConflictApps();
    const conflictWarning = formatUsbConflictWarning(conflictApps);

    if (conflictWarning) {
      return bufferError(conflictWarning, {
        mtpStatus: false,
        reportError: false,
      });
    }

    return bufferError(mtpErrors[MTP_ERROR.ErrorMtpDetectFailed], {
      throwAlert: false,
      logError: false,
      mtpStatus: false,
      reportError: false,
    });
  }

  switch (stderr) {
    case MTP_ERROR.ErrorMtpDetectFailed:
    case MTP_ERROR.ErrorDeviceSetup:
      const conflictApps = await getActiveUsbConflictApps();
      const conflictWarning = formatUsbConflictWarning(conflictApps);

      if (conflictWarning) {
        return bufferError(conflictWarning, {
          mtpStatus: false,
          reportError: false,
        });
      }

      // Keep the older AFT-only path as a fallback for exact process names.
      if (await isGoogleAndroidFileTransferActive()) {
        return bufferError(
          `Quit 'Android File Transfer' app (by Google) and Refresh`,
          { mtpStatus: false, reportError: false },
        );
      }

      break;

    default:
      break;
  }

  switch (stderr) {
    case MTP_ERROR.ErrorStorageFull:
    case MTP_ERROR.ErrorMultipleDevice:
    case MTP_ERROR.ErrorAllowStorageAccess:
    case MTP_ERROR.ErrorDeviceLocked:
      return bufferError(processedErrorValue, {
        mtpStatus: false,
        reportError: false,
      });
    case MTP_ERROR.ErrorNoStorage:
    case MTP_ERROR.ErrorStorageInfo:
    case MTP_ERROR.ErrorDeviceInfo:
    case MTP_ERROR.ErrorDeviceSetup:
      return bufferError(processedErrorValue, {
        mtpStatus: false,
        reportError: true,
      });
    case MTP_ERROR.ErrorSendObject:
    case MTP_ERROR.ErrorFileObjectRead:
    case MTP_ERROR.ErrorFileTransfer: {
      const conflictApps = await getActiveUsbConflictApps();
      const warning = formatUsbConflictWarning(conflictApps);
      return bufferError(
        warning ? `${processedErrorValue} ${warning}` : processedErrorValue,
        { mtpStatus: true, reportError: true },
      );
    }
    case MTP_ERROR.ErrorFileNotFound:
    case MTP_ERROR.ErrorMtpLockExists:
      return bufferError(processedErrorValue, {
        mtpStatus: true,
        reportError: false,
      });
    case MTP_ERROR.ErrorDeviceChanged:
      return bufferError(processedErrorValue, {
        throwAlert: false,
        mtpStatus: false,
        reportError: false,
      });
    default:
      return bufferError(processedErrorValue, {
        mtpStatus: true,
        reportError: true,
      });
  }
};

export const _processLegacyMtpBuffer = async ({ error, stderr }) => {
  // Error string are used for partial error string matching
  // this will be later used to pick the appropriate error out from the [errorDictionary]
  const errorTpl = {
    noMtp: `no mtp`,
    deviceLocked: `your device may be locked`,
    invalidObjectHandle: `invalid response code InvalidObjectHandle`,
    invalidStorageID: `invalid response code InvalidStorageID`,
    fileNotFound: `could not find`,
    noFilesSelected: `No files selected`,
    invalidPath: `Invalid path`,
    noSuchFiles: `No such file or directory`,
    writePipe: `WritePipe`,
    mtpStorageNotAccessible1: `MTP storage not accessible`,
    mtpStorageNotAccessible2: `error: storage`,
    partialDeletion: `PartialDeletion`,
    noPerm1: `cannot open file`,
  };

  // Error output shown to the user as a snackbar.
  const errorDictionary = {
    noPerm: `Operation not permitted.`,
    noMtp: `No ${DEVICES_LABEL[DEVICE_TYPE.mtp]} or MTP device found.`,
    googleAndroidFileTransferIsActive: `Quit 'Android File Transfer' app (by Google) and Refresh.`,
    usbConflictAppsActive: `Quit Preview, Android File Transfer, Google Drive, Dropbox, or OneDrive — they can hold the USB/MTP connection.`,
    deviceLocked: `Unlock your ${
      DEVICES_LABEL[DEVICE_TYPE.mtp]
    } and refresh again`,
    unResponsive: `Your ${
      DEVICES_LABEL[DEVICE_TYPE.mtp]
    } is not responding. Reload or reconnect the device.`,
    mtpStorageNotAccessible: `Your ${
      DEVICES_LABEL[DEVICE_TYPE.mtp]
    } storage is not accessible.`,
    fileNotFound: `File not found! Try again.`,
    partialDeletion: `The path is inaccessible.`,
    common: `Oops.. Your ${
      DEVICES_LABEL[DEVICE_TYPE.mtp]
    } has gone crazy! Try again.`,
  };

  const errorStringified =
    typeof error !== 'undefined' && error !== null ? error.toString() : '';
  const stderrStringified =
    typeof stderr !== 'undefined' && stderr !== null ? stderr.toString() : '';

  if (!errorStringified && !stderrStringified) {
    return bufferError(null, { throwAlert: false, mtpStatus: true });
  }

  const lowerError = errorStringified.toLowerCase();
  const lowerStderr = stderrStringified.toLowerCase();
  const checkError = (key) => {
    const needle = errorTpl[key].toLowerCase();
    return lowerError.includes(needle) || lowerStderr.includes(needle);
  };

  const noMtpError = isNoMtpError({ error, stderr, mtpMode: MTP_MODE.legacy });

  if (!noMtpError) {
    log.doLog(
      `MTP buffer o/p logging;${EOL}MTP Mode: ${
        MTP_MODE.legacy
      }${EOL}error: ${errorStringified.trim()}${EOL}stderr: ${stderrStringified.trim()}`,
      'processLegacyMtpBuffer',
    );
  }

  if (
    /* No MTP device found */
    noMtpError
  ) {
    const conflictApps = await getActiveUsbConflictApps();
    const conflictWarning = formatUsbConflictWarning(conflictApps);

    if (conflictWarning) {
      return bufferError(conflictWarning, {
        mtpStatus: false,
        reportError: false,
      });
    }

    if (await isGoogleAndroidFileTransferActive()) {
      return bufferError(errorDictionary.googleAndroidFileTransferIsActive, {
        mtpStatus: false,
        reportError: false,
      });
    }

    return bufferError(errorDictionary.noMtp, {
      throwAlert: false,
      logError: false,
      mtpStatus: false,
      reportError: false,
    });
  }

  if (
    /* MTP device may be locked */
    checkError('deviceLocked')
  ) {
    return bufferError(errorDictionary.deviceLocked, {
      mtpStatus: false,
      reportError: false,
    });
  }

  if (
    /* error: Get: invalid response code InvalidObjectHandle (0x2009) */
    checkError('invalidObjectHandle')
  ) {
    return bufferError(errorDictionary.unResponsive, {
      mtpStatus: false,
      reportError: true,
    });
  }

  if (
    /* error: Get: invalid response code InvalidStorageID */
    checkError('invalidStorageID')
  ) {
    return bufferError(errorDictionary.unResponsive, {
      mtpStatus: false,
      reportError: true,
    });
  }

  if (
    /* error: (*interface)->WritePipe(interface, ep->GetRefIndex(), buffer.data(), r): error 0xe00002eb */
    checkError('writePipe')
  ) {
    return bufferError(errorDictionary.unResponsive, {
      mtpStatus: false,
      reportError: true,
    });
  }

  if (
    /* MTP storage not accessible */
    checkError('mtpStorageNotAccessible1') ||
    checkError('mtpStorageNotAccessible2')
  ) {
    return bufferError(errorDictionary.mtpStorageNotAccessible, {
      mtpStatus: false,
      reportError: true,
    });
  }

  if (
    /* Path not found */
    checkError('fileNotFound')
  ) {
    return bufferError(sanitizeErrors(stderrStringified || errorStringified), {
      mtpStatus: true,
      reportError: true,
    });
  }

  if (
    /* No Permission */
    checkError('noPerm1')
  ) {
    return bufferError(errorDictionary.noPerm, {
      mtpStatus: true,
      reportError: true,
    });
  }

  if (
    /* No such file or directory */
    checkError('noSuchFiles')
  ) {
    return bufferError(errorDictionary.fileNotFound, {
      mtpStatus: true,
      reportError: true,
    });
  }

  if (
    /* No files selected */
    checkError('noFilesSelected') ||
    checkError('invalidPath')
  ) {
    return bufferError(sanitizeErrors(stderrStringified || errorStringified), {
      mtpStatus: true,
      reportError: true,
    });
  }

  if (
    /* No files selected */
    checkError('partialDeletion')
  ) {
    return bufferError(errorDictionary.partialDeletion, {
      mtpStatus: true,
      reportError: true,
    });
  }

  /* common errors */
  return bufferError(errorDictionary.common, {
    mtpStatus: true,
    reportError: true,
  });
};

// Error output shown to the user as a snackbar.
export const localErrorDictionary = {
  noPerm: `Operation not permitted`,
  commandFailed: `Could not complete! Try again.`,
  common: `Oops.. Your device has gone crazy! Try again.`,
  unResponsive: `Device is not responding! Reload`,
  invalidPath: `Invalid path`,
  fileNotFound: `File not found! Try again.`,
};

export const processLocalBuffer = ({ error, stderr }) => {
  // Partial error string used for matching the error
  // this will be later used to pick the appropriate error out from the [localErrorDictionary]
  const errorTpl = {
    noPerm1: `Operation not permitted`,
    noPerm2: `Permission denied`,
    commandFailed: `Command failed`,
    noSuchFiles: `No such file or directory`,
    resourceBusy: `resource busy or locked`,
  };

  const errorStringified =
    typeof error !== 'undefined' && error !== null ? error.toString() : '';
  const stderrStringified =
    typeof stderr !== 'undefined' && stderr !== null ? stderr.toString() : '';

  if (!errorStringified && !stderrStringified) {
    return bufferError(null, { throwAlert: false });
  }

  const lowerError = errorStringified.toLowerCase();
  const lowerStderr = stderrStringified.toLowerCase();
  const checkError = (key) => {
    const needle = errorTpl[key].toLowerCase();
    return lowerError.includes(needle) || lowerStderr.includes(needle);
  };

  log.doLog(
    `Local buffer o/p logging;${EOL}error: ${errorStringified.trim()}${EOL}stderr: ${stderrStringified.trim()}`,
    'processLocalBuffer',
  );

  if (
    /* No Permission */
    checkError('noPerm1') ||
    checkError('noPerm2')
  ) {
    return bufferError(localErrorDictionary.noPerm);
  }

  if (
    /* Command failed */
    checkError('commandFailed')
  ) {
    return bufferError(localErrorDictionary.commandFailed);
  }

  if (
    /* No such file or directory */
    checkError('noSuchFiles')
  ) {
    return bufferError(localErrorDictionary.fileNotFound, { mtpStatus: true });
  }

  if (
    /* Resource busy or locked */
    checkError('resourceBusy')
  ) {
    return bufferError(localErrorDictionary.commandFailed);
  }

  /* common errors */
  return bufferError(localErrorDictionary.common);
};

const sanitizeErrors = (string) => {
  if (string === null) {
    return `Oops.. Try again`;
  }

  string = string.replace(/^(error: )/, '').trim(); // oxlint-disable-line no-param-reassign
  string = replaceBulk(string, ['error:', 'stat failed:'], ['', '']).trim(); // oxlint-disable-line no-param-reassign

  return string.charAt(0).toUpperCase() + string.slice(1);
};
