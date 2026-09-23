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
