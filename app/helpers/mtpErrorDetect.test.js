import { describe, expect, test } from 'bun:test';
import { isNoMtpError } from './mtpErrorDetect';
import { MTP_ERROR } from '../enums/mtpError';
import { MTP_MODE } from '../enums';

describe('isNoMtpError', () => {
  test('detects legacy no-mtp stderr', () => {
    expect(
      isNoMtpError({
        error: null,
        stderr: 'No MTP devices found',
        mtpMode: MTP_MODE.legacy,
      }),
    ).toBe(true);
  });

  test('detects kalam detect-failed stderr', () => {
    expect(
      isNoMtpError({
        error: null,
        stderr: MTP_ERROR.ErrorMtpDetectFailed,
        mtpMode: MTP_MODE.kalam,
      }),
    ).toBe(true);
  });

  test('detects kalam setup failures with libusb not found', () => {
    expect(
      isNoMtpError({
        error: 'LIBUSB_ERROR_NOT_FOUND while claiming',
        stderr: MTP_ERROR.ErrorDeviceSetup,
        mtpMode: MTP_MODE.kalam,
      }),
    ).toBe(true);
  });

  test('returns false for unrelated errors', () => {
    expect(
      isNoMtpError({
        error: 'disk full',
        stderr: MTP_ERROR.ErrorStorageFull,
        mtpMode: MTP_MODE.kalam,
      }),
    ).toBe(false);
  });
});
