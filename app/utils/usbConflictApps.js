import { isAnyProcessRunning, isProcessRunning } from './process';

/**
 * Apps known to claim Android/MTP USB sessions on macOS and break OpenMTP.
 * Preview.app started stealing MTP mounts more aggressively on Ventura+.
 */
export const USB_CONFLICT_APPS = [
  {
    id: 'android-file-transfer',
    label: 'Android File Transfer',
    patterns: ['Android File Transfer'],
  },
  {
    id: 'android-file-transfer-agent',
    label: 'Android File Transfer Agent',
    patterns: ['Android File Transfer Agent'],
  },
  {
    id: 'preview',
    label: 'Preview',
    patterns: [
      '/Applications/Preview.app',
      'Preview.app/Contents/MacOS/Preview',
    ],
  },
  {
    id: 'google-drive',
    label: 'Google Drive',
    patterns: ['Google Drive', 'GoogleDrive', '/Applications/Google Drive.app'],
  },
  {
    id: 'dropbox',
    label: 'Dropbox',
    patterns: [
      '/Applications/Dropbox.app',
      'Dropbox.app/Contents/MacOS/Dropbox',
    ],
  },
  {
    id: 'onedrive',
    label: 'OneDrive',
    patterns: [
      '/Applications/OneDrive.app',
      'OneDrive.app/Contents/MacOS/OneDrive',
    ],
  },
];

export const formatUsbConflictWarning = (activeApps = []) => {
  if (!activeApps.length) {
    return null;
  }

  const names = activeApps.map((app) => `'${app.label}'`).join(', ');

  return `Quit ${names} — ${
    activeApps.length === 1 ? 'it is' : 'they are'
  } holding the USB/MTP connection. Then refresh.`;
};

/**
 * Returns the subset of {@link USB_CONFLICT_APPS} currently running.
 */
export const getActiveUsbConflictApps = async () => {
  const active = [];

  // eslint-disable-next-line no-restricted-syntax
  for (const app of USB_CONFLICT_APPS) {
    // eslint-disable-next-line no-await-in-loop
    const running = await isAnyProcessRunning(app.patterns);

    if (running) {
      active.push(app);
    }
  }

  return active;
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
