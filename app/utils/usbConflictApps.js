import { isAnyProcessRunning, isProcessRunning } from './process';
import {
  USB_CONFLICT_APPS,
  formatUsbConflictWarning,
} from './usbConflictApps.format';

export { USB_CONFLICT_APPS, formatUsbConflictWarning };

/**
 * Returns the subset of {@link USB_CONFLICT_APPS} currently running.
 */
export const getActiveUsbConflictApps = async () => {
  const runningFlags = await Promise.all(
    USB_CONFLICT_APPS.map((app) => isAnyProcessRunning(app.patterns)),
  );

  return USB_CONFLICT_APPS.filter((_, index) => runningFlags[index]);
};

/**
 * Backward-compatible helper used by existing MTP error paths.
 * Treat either the AFT UI or its background agent as a conflict.
 */
export const isGoogleAndroidFileTransferActive = async () => {
  const [aft, agent] = await Promise.all([
    isProcessRunning('Android File Transfer'),
    isProcessRunning('Android File Transfer Agent'),
  ]);

  return aft || agent;
};
