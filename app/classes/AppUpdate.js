import { BrowserWindow, dialog, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import { isConnected } from '../utils/isOnline';
import { log } from '../utils/log';
import { isPackaged } from '../utils/isPackaged';
import { PATHS } from '../constants/paths';
import { unixTimestampNow } from '../utils/date';
import { undefinedOrNull } from '../utils/funcs';
import {
  getMainWindowMainProcess,
  getWindowBackgroundColor,
} from '../helpers/windowHelper';
import { appUpdateAvailableWindow } from '../helpers/createWindows';
import { UPDATER_STATUS } from '../enums/appUpdater';
import { getRemoteWindow } from '../helpers/remoteWindowHelpers';

let progressbarWindow = null;
let isFileTransferActiveFlag = false;
let mainWindow = null;

const remote = getRemoteWindow();

remote.initialize();

const createChildWindow = () => {
  try {
    return new BrowserWindow({
      parent: mainWindow,
      modal: true,
      show: false,
      height: 150,
      width: 600,
      title: 'Progress...',
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      movable: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        enableRemoteModule: true,
      },
      backgroundColor: getWindowBackgroundColor(),
    });
  } catch (e) {
    log.error(e, `AppUpdate -> createChildWindow`);
  }
};

const fireProgressbar = () => {
  try {
    if (progressbarWindow) {
      progressbarWindow.show();
      progressbarWindow.focus();

      return null;
    }

    mainWindow.webContents.send('isFileTransferActiveSeek', {
      check: true,
    });

    ipcMain.once('isFileTransferActiveReply', (event, { ...args }) => {
      const { isActive } = args;

      isFileTransferActiveFlag = isActive;
    });

    progressbarWindow = createChildWindow();
    remote.enable(progressbarWindow.webContents);

    progressbarWindow.loadURL(
      `${PATHS.loadUrlPath}#appUpdatePage/updateProgress`,
    );

    progressbarWindow.webContents.on('did-finish-load', () => {
      progressbarWindow.show();
      progressbarWindow.focus();
    });

    progressbarWindow.on('closed', () => {
      progressbarWindow = null;
    });

    progressbarWindow.onerror = (error) => {
      log.error(error, `AppUpdate -> progressbarWindow -> onerror`);
    };
  } catch (e) {
    log.error(e, `AppUpdate -> fireProgressbar`);
  }
};

export default class AppUpdate {
  constructor({ autoUpdateCheck, autoDownload, allowPrerelease }) {
    this.autoUpdater = autoUpdater;
    if (!isPackaged) {
      this.autoUpdater.updateConfigPath = PATHS.devAppUpdateFile;
    }

    this.autoUpdater.autoDownload = autoUpdateCheck && autoDownload;
    this.autoUpdater.allowPrerelease = allowPrerelease;
    this.autoUpdateCheck = autoUpdateCheck;

    this.progressbarWindowDomReadyFlag = null;
    this.updateInitFlag = false;
    this.updateForceCheckFlag = false;
    this.handledUpdateErrors = new WeakSet();
    this._errorDialog = {
      timeGenerated: 0,
      title: null,
      message: null,
    };

    this.updateStatus = UPDATER_STATUS.inactive;
    this.disableAutoUpdateCheck = false;
  }

  init() {
    try {
      if (this.updateInitFlag) {
        return;
      }

      this.autoUpdater.on('error', (error) => this.handleUpdateError(error));

      this.autoUpdater.on('checking-for-update', () => {
        if (this.updateForceCheckFlag) this.setCheckUpdatesProgress();
      });

      this.autoUpdater.on('update-not-available', () => {
        const manual = this.updateForceCheckFlag;
        this.updateForceCheckFlag = false;
        this.closeActiveUpdates();
        if (progressbarWindow !== null) progressbarWindow.close();
        if (manual) {
          void dialog.showMessageBox({
            title: 'No Updates Found',
            message: 'You have the latest version installed.',
            buttons: ['Close'],
          });
        }
      });

      this.autoUpdater.on('update-available', (info) => {
        if (
          progressbarWindow !== null &&
          this.updateStatus !== UPDATER_STATUS.updateInProgress
        ) {
          progressbarWindow.close();
        }

        // When auto background update download and auto update check are active prevent other ways (manual) of download handling.
        if (this.autoUpdater.autoDownload && this.autoUpdateCheck) {
          this.closeActiveUpdates(-1);

          return;
        }

        const _appUpdateAvailableWindow = appUpdateAvailableWindow();

        _appUpdateAvailableWindow.on('close', () => {
          if (this.updateStatus !== UPDATER_STATUS.updateInProgress) {
            this.updateForceCheckFlag = false;
            this.closeActiveUpdates();
          }
        });

        _appUpdateAvailableWindow.webContents.once('dom-ready', () => {
          _appUpdateAvailableWindow.webContents.send(
            'appUpdatesUpdateAvailableCommunication',
            info,
          );
        });

        ipcMain.once('appUpdatesUpdateAvailableReply', (event, { ...args }) => {
          const { confirm } = args;

          if (!confirm) {
            if (this.updateStatus !== UPDATER_STATUS.updateInProgress) {
              this.updateForceCheckFlag = false;
              this.closeActiveUpdates();
            }

            return null;
          }

          if (progressbarWindow !== null) {
            progressbarWindow.close();
          }

          this.updateForceCheckFlag = true;
          this.closeActiveUpdates(UPDATER_STATUS.updateInProgress);
          this.initDownloadUpdatesProgress();

          // this is to prevent race condition
          if (!this.autoUpdater.autoDownload) {
            void this.autoUpdater
              .downloadUpdate()
              .catch((error) => this.handleUpdateError(error));
          }
        });
      });

      this.autoUpdater.on('download-progress', (progress) => {
        if (progressbarWindow === null) {
          return null;
        }

        this.setUpdateProgressWindow({ value: progress.percent || 0 });
      });

      this.autoUpdater.on('update-downloaded', async () => {
        this.updateForceCheckFlag = false;
        this.closeActiveUpdates();
        if (progressbarWindow !== null) {
          progressbarWindow.close();
        }

        const { response: buttonIndex } = await dialog.showMessageBox({
          title: 'Install Updates',
          message: 'Updates downloaded. Application will quit now...',
          buttons: ['Install and Relaunch'],
        });

        switch (buttonIndex) {
          case 0:
          default:
            this.autoUpdater.quitAndInstall();
            break;
        }
      });

      this.updateInitFlag = true;
    } catch (e) {
      log.error(e, `AppUpdate -> init`);
    }
  }

  handleUpdateError(error) {
    // electron-updater emits an error and rejects the same request. Handle it
    // once, while consuming the promise rejection to keep startup stable.
    if (error && typeof error === 'object') {
      if (this.handledUpdateErrors.has(error)) return;
      this.handledUpdateErrors.add(error);
    }
    const manual = this.updateForceCheckFlag;
    this.updateForceCheckFlag = false;
    if (progressbarWindow !== null) progressbarWindow.close();
    this.closeActiveUpdates();
    log.info(error, 'AppUpdate -> update check failed', true, false, false);
    if (!manual) return;

    let message = 'Could not check for updates. Please try again later.';
    if (this.isNetworkError(error)) {
      message =
        'Could not connect to the update server. Check your internet connection and try again.';
    } else if (
      /No published versions|ERR_UPDATER_NO_PUBLISHED_VERSIONS/i.test(
        `${error?.message} ${error?.code}`,
      )
    ) {
      message =
        'No releases have been published for this OpenMTP fork yet. Your installed app is ready to use.';
    }
    void this.spitMessageDialog('Update Error', message, 'error');
  }

  async checkForUpdates() {
    try {
      this.setMainWindow();
      if (!mainWindow || !(await isConnected())) return;
      if (
        this.updateStatus !== UPDATER_STATUS.inactive ||
        this.disableAutoUpdateCheck
      )
        return;
      this.updateForceCheckFlag = false;
      this.updateStatus = UPDATER_STATUS.checkInProgress;
      await this.autoUpdater.checkForUpdates();
    } catch (error) {
      this.handleUpdateError(error);
    }
  }

  async forceCheck() {
    try {
      this.setMainWindow();
      if (!mainWindow) return;
      if (this.updateStatus === UPDATER_STATUS.checkInProgress) return;
      if (this.updateStatus === UPDATER_STATUS.updateInProgress) {
        const { response } = await dialog.showMessageBox({
          title: 'Update in progress',
          message: 'Another update is in progress. Restart the update?',
          buttons: ['Cancel', 'Yes'],
        });
        if (response !== 1) return;
      }
      // Set intent before invoking the updater: checking-for-update can fire
      // synchronously, including when the request immediately fails.
      this.updateForceCheckFlag = true;
      this.updateStatus = UPDATER_STATUS.checkInProgress;
      await this.autoUpdater.checkForUpdates();
    } catch (error) {
      this.handleUpdateError(error);
    }
  }

  setCheckUpdatesProgress() {
    try {
      isConnected()
        .then((connected) => {
          if (!connected) {
            this.spitMessageDialog(
              'Checking For Updates',
              'Internet connection is unavailable.',
            );

            return null;
          }

          if (
            !this.updateForceCheckFlag ||
            this.updateStatus !== UPDATER_STATUS.checkInProgress
          )
            return null;
          fireProgressbar();
          this.setTaskBarProgressBar(2);

          progressbarWindow.webContents.once('dom-ready', () => {
            progressbarWindow.webContents.send(
              'appUpdatesProgressBarCommunication',
              {
                progressTitle: `Checking For Updates`,
                progressBodyText: `Please wait...`,
                value: 0,
                variant: `indeterminate`,
              },
            );
          });

          return true;
        })
        .catch(() => {});
    } catch (e) {
      log.error(e, `AppUpdate -> setCheckUpdatesProgress`);
    }
  }

  initDownloadUpdatesProgress() {
    try {
      isConnected()
        .then((connected) => {
          if (!connected) {
            this.spitMessageDialog(
              'Downloading Updates',
              'Internet connection is unavailable.',
            );

            return null;
          }

          fireProgressbar();
          this.progressbarWindowDomReadyFlag = false;
          this.setUpdateProgressWindow({ value: 0 });

          return true;
        })
        .catch(() => {});
    } catch (e) {
      log.error(e, `AppUpdate -> initDownloadUpdatesProgress`);
    }
  }

  setUpdateProgressWindow({ value = 0 }) {
    try {
      const data = {
        progressTitle: `Downloading Updates`,
        progressBodyText: `Please wait...`,
        value,
        variant: `determinate`,
      };

      this.setTaskBarProgressBar(value / 100);
      if (this.progressbarWindowDomReadyFlag) {
        progressbarWindow.webContents.send(
          'appUpdatesProgressBarCommunication',
          data,
        );

        return null;
      }

      progressbarWindow.webContents.once('dom-ready', () => {
        progressbarWindow.webContents.send(
          'appUpdatesProgressBarCommunication',
          data,
        );

        this.progressbarWindowDomReadyFlag = true;
      });
    } catch (e) {
      log.error(e, `AppUpdate -> setUpdateProgressWindow`);
    }
  }

  setMainWindow() {
    const _mainWindow = getMainWindowMainProcess();

    if (undefinedOrNull(_mainWindow)) {
      return null;
    }

    mainWindow = _mainWindow;
  }

  setTaskBarProgressBar(value) {
    try {
      if (isFileTransferActiveFlag) {
        return null;
      }

      mainWindow.setProgressBar(value);
    } catch (e) {
      log.error(e, `AppUpdate -> setTaskBarProgressBar`);
    }
  }

  isNetworkError(errorObj) {
    return (
      errorObj?.message === 'net::ERR_INTERNET_DISCONNECTED' ||
      errorObj?.message === 'net::ERR_PROXY_CONNECTION_FAILED' ||
      errorObj?.message === 'net::ERR_CONNECTION_RESET' ||
      errorObj?.message === 'net::ERR_CONNECTION_CLOSE' ||
      errorObj?.message === 'net::ERR_NAME_NOT_RESOLVED' ||
      errorObj?.message === 'net::ERR_CONNECTION_TIMED_OUT'
    );
  }

  async spitMessageDialog(title, message, type = 'message') {
    const { timeGenerated: _timeGenerated } = this._errorDialog;
    const delayTime = 1000;

    if (
      _timeGenerated !== 0 &&
      unixTimestampNow() - _timeGenerated < delayTime
    ) {
      return null;
    }

    this._errorDialog = {
      timeGenerated: unixTimestampNow(),
      title,
      message,
    };

    switch (type) {
      case 'error':
        dialog.showErrorBox(title, message);
        break;

      case 'message':
      default:
        // oxlint-disable-next-line no-case-declarations
        const { response: buttonIndex } = await dialog.showMessageBox({
          title,
          message,
          buttons: ['Close'],
        });

        switch (buttonIndex) {
          case 0:
          default:
            break;
        }

        break;
    }
  }

  closeActiveUpdates(updateStatus = UPDATER_STATUS.inactive) {
    this.setTaskBarProgressBar(-1);
    this.updateStatus = updateStatus;
  }
}
