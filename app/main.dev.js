/* eslint global-require: off */

import './services/sentry/index';

import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron';
import electronIs from 'electron-is';
import { usb as usbMonitor } from 'usb';
import process from 'process';
import MenuBuilder from './menu';
import { log } from './utils/log';
import { DEBUG_PROD, ENV_FLAVOR, IS_DEV, IS_PROD } from './constants/env';
import AppUpdate from './classes/AppUpdate';
import { PATHS } from './constants/paths';
import { settingsStorage } from './helpers/storageHelper';
import { AUTO_UPDATE_CHECK_FIREUP_DELAY } from './constants';
import { appEvents } from './utils/eventHandling';
import { bootLoader } from './helpers/bootHelper';
import { nonBootableDeviceWindow } from './helpers/createWindows';
import { APP_TITLE } from './constants/meta';
import { isPackaged } from './utils/isPackaged';
import { getWindowBackgroundColor } from './helpers/windowHelper';
import { APP_THEME_MODE_TYPE, MTP_MODE, USB_HOTPLUG_EVENTS } from './enums';
import { getEnablePrereleaseUpdatesSetting } from './helpers/settings';
import { getRemoteWindow } from './helpers/remoteWindowHelpers';
import { IpcEvents } from './services/ipc-events/IpcEventType';
import IpcEventService from './services/ipc-events/IpcEventHandler';
import { isKalamModeSupported } from './helpers/binaries';
import { fileExistsSync } from './helpers/fileOps';

const remote = getRemoteWindow();

if (IS_DEV && process.env.OPENMTP_REMOTE_DEBUG_PORT) {
  app.commandLine.appendSwitch(
    'remote-debugging-port',
    process.env.OPENMTP_REMOTE_DEBUG_PORT,
  );
}

const isSingleInstance = app.requestSingleInstanceLock();
const isDeviceBootable = bootTheDevice();
const isMas = electronIs.mas();
let mainWindow = null;
let usbAttachListener = null;
let usbDetachListener = null;

if (IS_PROD) {
  const sourceMapSupport = require('source-map-support');

  sourceMapSupport.install();
}

if (IS_DEV || DEBUG_PROD) {
  require('electron-debug')();
}

async function bootTheDevice() {
  try {
    // For an existing installation
    if (bootLoader.quickVerify()) {
      return true;
    }

    // For a fresh installation
    await bootLoader.init();

    return await bootLoader.verify();
  } catch (e) {
    throw new Error(e, { cause: e });
  }
}

function fixSettings() {
  const { settingsFile } = PATHS;

  if (!fileExistsSync(settingsFile)) {
    return;
  }

  const settings = settingsStorage.getItems([
    'mtpMode',
    'wasForcedToToggleMtpModeForMinOsRequirement',
  ]);

  if (!settings) {
    return;
  }

  const shouldEnableKalamMode = isKalamModeSupported();

  // Since we have now officially retired the support for `Kalam` Kernel on macOS 10.13 (OS X El High Sierra) and lower. Only the "Legacy" MTP mode will continue working on the outdated machines.
  // Here we toggle the MTP mode to legacy mode for the older macOSes and will mark it as a forceful toggle.
  // And once the user upgrades their OS and the [wasForcedToToggleMtpModeForMinOsRequirement] was true then we toggle the user back to Kalam MTP mode.
  if (settings.wasForcedToToggleMtpModeForMinOsRequirement === true) {
    if (shouldEnableKalamMode && settings.mtpMode === MTP_MODE.legacy) {
      settingsStorage.setItems({
        mtpMode: MTP_MODE.kalam,
        wasForcedToToggleMtpModeForMinOsRequirement: false,
      });
    }
  } else if (!shouldEnableKalamMode && settings.mtpMode === MTP_MODE.kalam) {
    settingsStorage.setItems({
      mtpMode: MTP_MODE.legacy,
      wasForcedToToggleMtpModeForMinOsRequirement: true,
    });
  }
}

async function installExtensions() {
  const {
    default: installExtension,
    REDUX_DEVTOOLS,
    REACT_DEVELOPER_TOOLS,
  } = await import('electron-devtools-installer');

  const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
  const extensions = [REACT_DEVELOPER_TOOLS, REDUX_DEVTOOLS];

  return installExtension(extensions, {
    forceDownload,
  }).catch((err) =>
    log.error(
      `An extension error occurred: ${err}`,
      `main.dev -> installExtensions`,
    ),
  );
}

function normalizeUsbHotplugDevice(device) {
  const descriptor = device?.deviceDescriptor || {};

  return {
    manufacturer: null,
    deviceName: null,
    productId: descriptor.idProduct || null,
    vendorId: descriptor.idVendor || null,
    serialNumber: null,
    busNumber: device?.busNumber || null,
    deviceAddress: device?.deviceAddress || null,
  };
}

async function createWindow() {
  try {
    if (ENV_FLAVOR.allowDevelopmentEnvironment) {
      await installExtensions();
    }

    mainWindow = new BrowserWindow({
      title: `${APP_TITLE}`,
      center: true,
      show: false,
      minWidth: 880,
      minHeight: 640,
      titleBarStyle: 'hidden',
      webPreferences: {
        enableRemoteModule: true,
        nodeIntegration: true,
        contextIsolation: false,
        webSecurity: !IS_DEV,
      },
      backgroundColor: getWindowBackgroundColor(),
    });

    remote.enable(mainWindow.webContents);

    mainWindow.webContents.on('console-message', (details) => {
      const shouldLogConsoleMessage =
        process.env.OPENMTP_RENDERER_DIAGNOSTICS === '1' ||
        details.level === 'warning' ||
        details.level === 'error';

      if (!shouldLogConsoleMessage) {
        return;
      }

      log.error(
        `[renderer-console:${details.level}] ${details.message} (${details.sourceId}:${details.lineNumber})`,
        'main.dev -> webContents -> console-message',
      );
    });

    mainWindow.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        log.error(
          `did-fail-load code=${errorCode} mainFrame=${isMainFrame} url=${validatedURL} error=${errorDescription}`,
          'main.dev -> webContents -> did-fail-load',
        );
      },
    );

    mainWindow.webContents.on(
      'did-fail-provisional-load',
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        log.error(
          `did-fail-provisional-load code=${errorCode} mainFrame=${isMainFrame} url=${validatedURL} error=${errorDescription}`,
          'main.dev -> webContents -> did-fail-provisional-load',
        );
      },
    );

    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      log.error(
        `render-process-gone reason=${details?.reason} exitCode=${details?.exitCode}`,
        'main.dev -> webContents -> render-process-gone',
      );
    });

    mainWindow.webContents.on('unresponsive', () => {
      log.error(
        'Renderer became unresponsive',
        'main.dev -> webContents -> unresponsive',
      );
    });

    mainWindow?.loadURL(`${PATHS.loadUrlPath}`);

    mainWindow?.webContents?.on('did-finish-load', () => {
      if (!mainWindow) {
        throw new Error(`"mainWindow" is not defined`);
      }

      if (process.env.OPENMTP_RENDERER_DIAGNOSTICS === '1') {
        setTimeout(() => {
          mainWindow?.webContents
            ?.executeJavaScript(
              `(() => {
                const root = document.getElementById('root');
                return {
                  href: window.location.href,
                  title: document.title,
                  bodyClassName: document.body?.className || '',
                  bodyChildCount: document.body?.children?.length || 0,
                  rootChildCount: root?.children?.length || 0,
                  rootTextLength: root?.textContent?.trim()?.length || 0,
                  rootHtmlSnippet: root?.innerHTML?.slice(0, 500) || '',
                };
              })();`,
            )
            .then((details) => {
              return log.error(
                JSON.stringify(details),
                'main.dev -> webContents -> renderer-diagnostics',
              );
            })
            .catch((error) => {
              log.error(
                error,
                'main.dev -> webContents -> renderer-diagnostics',
              );
            });
        }, 1500);
      }

      if (process.env.START_MINIMIZED) {
        mainWindow.minimize();
      } else {
        mainWindow.maximize();
        mainWindow.show();
        mainWindow.focus();
      }
    });

    mainWindow.onerror = (error) => {
      log.error(error, `main.dev -> mainWindow -> onerror`);
    };

    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  } catch (e) {
    log.error(e, `main.dev -> createWindow`);
  }
}

/**
 * Checks whether device is ready to boot or not.
 * Here profile files are created if not found.
 */
if (!isDeviceBootable) {
  app.on('ready', async () => {
    try {
      nonBootableDeviceWindow();
    } catch (e) {
      throw new Error(e, { cause: e });
    }
  });

  app.on('window-all-closed', () => {
    try {
      app.quit();
    } catch (e) {
      throw new Error(e, { cause: e });
    }
  });
} else {
  fixSettings();

  if (IS_PROD) {
    process.on('uncaughtException', (error) => {
      log.error(error, `main.dev -> process -> uncaughtException`);
    });

    appEvents.on('error', (error) => {
      log.error(error, `main.dev -> appEvents -> error`);
    });

    ipcMain.removeAllListeners('ELECTRON_BROWSER_WINDOW_ALERT');
    ipcMain.on('ELECTRON_BROWSER_WINDOW_ALERT', (event, message, title) => {
      ipcMain.error(
        message,
        `main.dev -> ipcMain -> on ELECTRON_BROWSER_WINDOW_ALERT -> ${title}`,
      );
      // oxlint-disable-next-line no-param-reassign
      event.returnValue = 0;
    });
  }

  if (!isSingleInstance) {
    app.quit();
  } else {
    try {
      app.on('second-instance', () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) {
            mainWindow.restore();
          }

          mainWindow.focus();
        }
      });

      app.on('ready', () => {});
    } catch (e) {
      log.error(e, `main.dev -> second-instance`);
    }
  }

  app.on('window-all-closed', () => {
    try {
      if (process.platform === 'darwin') {
        return;
      }

      app.quit();
    } catch (e) {
      log.error(e, `main.dev -> window-all-closed`);
    }
  });

  IpcEventService.shared.start();

  app
    .whenReady()
    // oxlint-disable-next-line promise/always-return
    .then(async () => {
      try {
        await createWindow();

        let appUpdaterEnable = true;

        if (isPackaged && process.platform === 'darwin') {
          appUpdaterEnable = !isMas && app.isInApplicationsFolder();
        }

        const autoUpdateCheckSettings = settingsStorage.getItems([
          'enableBackgroundAutoUpdate',
          'enableAutoUpdateCheck',
        ]);

        const autoUpdateCheck =
          autoUpdateCheckSettings.enableAutoUpdateCheck !== false;
        const isPrereleaseUpdatesEnabled = getEnablePrereleaseUpdatesSetting();

        const autoAppUpdate = new AppUpdate({
          autoUpdateCheck,
          autoDownload:
            autoUpdateCheckSettings.enableBackgroundAutoUpdate !== false,
          allowPrerelease: isPrereleaseUpdatesEnabled === true,
        });

        autoAppUpdate.init();

        const menuBuilder = new MenuBuilder({
          mainWindow,
          autoAppUpdate,
          appUpdaterEnable,
        });

        menuBuilder.buildMenu();

        if (autoUpdateCheck && appUpdaterEnable) {
          setTimeout(() => {
            autoAppUpdate.checkForUpdates();
          }, AUTO_UPDATE_CHECK_FIREUP_DELAY);
        }

        // send attach and detach events to the renderer
        usbAttachListener = (device) => {
          if (!mainWindow) {
            return;
          }

          mainWindow?.webContents?.send(IpcEvents.USB_HOTPLUG, {
            device: JSON.stringify(normalizeUsbHotplugDevice(device)),
            eventName: USB_HOTPLUG_EVENTS.attach,
          });
        };

        usbDetachListener = (device) => {
          if (!mainWindow) {
            return;
          }

          mainWindow?.webContents?.send(IpcEvents.USB_HOTPLUG, {
            device: JSON.stringify(normalizeUsbHotplugDevice(device)),
            eventName: USB_HOTPLUG_EVENTS.detach,
          });
        };

        usbMonitor.on('attach', usbAttachListener);
        usbMonitor.on('detach', usbDetachListener);
        usbMonitor.unrefHotplugEvents?.();

        process.stdout.on('error', (err) => {
          if (err.code === 'EPIPE') {
            process.exit(0);
          }
        });
      } catch (e) {
        log.error(e, `main.dev -> whenReady`);
      }

      app.on('activate', async () => {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        try {
          if (mainWindow === null) {
            await createWindow();
          }
        } catch (e) {
          log.error(e, `main.dev -> activate`);
        }
      });
    })
    .catch((e) => {
      log.error(e, `main.dev -> whenReady`);
    });

  app.on('before-quit', (event) => {
    if (usbAttachListener) {
      usbMonitor.off('attach', usbAttachListener);
      usbAttachListener = null;
    }

    if (usbDetachListener) {
      usbMonitor.off('detach', usbDetachListener);
      usbDetachListener = null;
    }

    // The live Kalam MTP session lives in the renderer. Ask it to dispose
    // cleanly before quitting so USB endpoints are released for the next run.
    if (
      !app.isMtpDisposeForQuitDone &&
      mainWindow &&
      !mainWindow.isDestroyed()
    ) {
      event.preventDefault();
      app.isMtpDisposeForQuitDone = true;

      const finishQuit = () => {
        ipcMain.removeListener(
          IpcEvents.APP_BEFORE_QUIT_DISPOSE_MTP_DONE,
          finishQuit,
        );

        if (app.mtpDisposeQuitFallbackTimer) {
          clearTimeout(app.mtpDisposeQuitFallbackTimer);
          app.mtpDisposeQuitFallbackTimer = null;
        }

        app.quitting = true;
        app.quit();
      };

      ipcMain.once(IpcEvents.APP_BEFORE_QUIT_DISPOSE_MTP_DONE, finishQuit);
      mainWindow.webContents.send(IpcEvents.APP_BEFORE_QUIT_DISPOSE_MTP);

      app.mtpDisposeQuitFallbackTimer = setTimeout(finishQuit, 1500);

      return;
    }

    app.quitting = true;
  });

  nativeTheme.on('updated', () => {
    const setting = settingsStorage.getItems(['appThemeMode']);

    // if the app theme is 'auto' and if the os theme has changed
    // then refresh the app theme
    if (setting.appThemeMode !== APP_THEME_MODE_TYPE.auto) {
      return;
    }

    if (!mainWindow) {
      return;
    }

    mainWindow?.webContents?.send('nativeThemeUpdated', {
      shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
    });
  });
}
