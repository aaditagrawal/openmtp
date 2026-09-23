import { checkIf } from '../utils/checkIf';
import { MTP_MODE } from '../enums';
import { MTP_ERROR } from '../enums/mtpError';

/**
 * Will return true if the error is a mtp detect error.
 *
 * @param {string} error
 * @param {string} stderr
 * @param {'kalam'|'legacy'} mtpMode
 */
export function isNoMtpError({ error, stderr, mtpMode }) {
  checkIf(mtpMode, 'inObjectValues', MTP_MODE);

  if (mtpMode === MTP_MODE.legacy) {
    return (
      (stderr ?? '').toString().toLowerCase().indexOf('no mtp') !== -1 ||
      (error ?? '').toString().toLowerCase().indexOf('no mtp') !== -1
    );
  }

  const kalamError = (error ?? '').toString().toLowerCase();

  return (
    stderr === MTP_ERROR.ErrorMtpDetectFailed ||
    ((stderr === MTP_ERROR.ErrorDeviceSetup ||
      stderr === MTP_ERROR.ErrorGeneral) &&
      (kalamError.includes('libusb_error_not_found') ||
        kalamError.includes('libusb_error_no_device') ||
        kalamError.includes('no mtp device') ||
        kalamError.includes('opensession failed') ||
        kalamError.includes('opensession after reset')))
  );
}
