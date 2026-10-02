import './guard';
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import { UPDATER_STATUS } from '../../app/enums/appUpdater';

// Exercise the real controller and event handlers without loading Electron's
// updater/network/native window APIs into the unit-test process.
const fixture = () => {
  const updater = new EventEmitter();
  const dialogs = [];
  const logs = [];
  const progress = [];
  const mainWindow = { setProgressBar() {} };
  const context = {
    autoUpdater: updater,
    isPackaged: true,
    isConnected: async () => true,
    getRemoteWindow: () => ({ initialize() {} }),
    getMainWindowMainProcess: () => mainWindow,
    undefinedOrNull: (value) => value == null,
    UPDATER_STATUS,
    unixTimestampNow: () => Date.now(),
    log: {
      info: (...args) => logs.push(args),
      error: (...args) => logs.push(args),
    },
    dialog: {
      showMessageBox: async (options) => {
        dialogs.push(options);
        return { response: 0 };
      },
      showErrorBox: (title, message) => dialogs.push({ title, message }),
    },
  };
  const source = readFileSync(
    new URL('../../app/classes/AppUpdate.js', import.meta.url),
    'utf8',
  )
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\n/gm, '')
    .replace('export default class AppUpdate', 'class AppUpdate');
  vm.runInNewContext(`${source}\nglobalThis.AppUpdate = AppUpdate;`, context);
  const controller = new context.AppUpdate({
    autoUpdateCheck: true,
    autoDownload: false,
  });
  controller.setCheckUpdatesProgress = () => progress.push(true);
  controller.init();
  return { updater, controller, dialogs, logs, progress };
};

const failRequest = (updater, message) => {
  updater.checkForUpdates = async () => {
    updater.emit('checking-for-update');
    const error = new Error(message);
    updater.emit('error', error);
    throw error;
  };
};

test('startup updater failure is logged once without dialogs or rejected request', async () => {
  const { updater, controller, dialogs, logs, progress } = fixture();
  failRequest(updater, 'No published versions on GitHub');
  await controller.checkForUpdates();
  expect(dialogs).toEqual([]);
  expect(progress).toEqual([]);
  expect(logs).toHaveLength(1);
  expect(controller.updateStatus).toBe(UPDATER_STATUS.inactive);
});

test('manual missing-release check displays a meaningful error once', async () => {
  const { updater, controller, dialogs, logs, progress } = fixture();
  failRequest(updater, 'No published versions on GitHub');
  await controller.forceCheck();
  expect(dialogs).toHaveLength(1);
  expect(dialogs[0].message).toContain(
    'No releases have been published for this OpenMTP fork',
  );
  expect(logs).toHaveLength(1);
  expect(progress).toHaveLength(1);
  expect(controller.updateForceCheckFlag).toBe(false);
});

test('manual network errors explain connectivity and later background checks stay quiet', async () => {
  const { updater, controller, dialogs, progress } = fixture();
  failRequest(updater, 'net::ERR_INTERNET_DISCONNECTED');
  await controller.forceCheck();
  expect(dialogs[0].message).toContain('internet connection');
  await controller.checkForUpdates();
  expect(dialogs).toHaveLength(1);
  expect(progress).toHaveLength(1);
});

test('manual no-update result does not accumulate listeners or affect later background checks', async () => {
  const { updater, controller, dialogs, progress } = fixture();
  updater.checkForUpdates = async () => {
    updater.emit('checking-for-update');
    updater.emit('update-not-available');
  };
  await controller.forceCheck();
  await controller.forceCheck();
  await controller.checkForUpdates();
  expect(dialogs).toHaveLength(2);
  expect(progress).toHaveLength(2);
  expect(updater.listenerCount('checking-for-update')).toBe(1);
  expect(updater.listenerCount('update-not-available')).toBe(1);
  expect(controller.updateStatus).toBe(UPDATER_STATUS.inactive);
});

test('promise-only updater rejection is consumed and shown for a manual check', async () => {
  const { updater, controller, dialogs } = fixture();
  updater.checkForUpdates = async () => {
    throw new Error('Unexpected server response');
  };
  await controller.forceCheck();
  expect(dialogs).toHaveLength(1);
  expect(dialogs[0].message).toContain('Could not check for updates');
});
