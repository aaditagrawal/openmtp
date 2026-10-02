/* eslint global-require: off */

import './services/sentry/index';

import { app, BrowserWindow, ipcMain, nativeTheme, dialog } from 'electron';
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
import { trace, traceError } from './utils/diagnostics';
import { updateProfileStorage } from './helpers/storageIpc';

const remote = getRemoteWindow();
trace('startup', {
  electron: process.versions.electron,
  node: process.versions.node,
  arch: process.arch,
});
process.on('unhandledRejection', (error) => {
  traceError('unhandled-rejection', error);
  log.error(error, 'main -> unhandledRejection');
});
process.on('uncaughtExceptionMonitor', (error) =>
  traceError('uncaught-exception', error),
);
app.on('child-process-gone', (_event, details) =>
  trace('child-process-gone', details),
);
app.on('will-quit', () => trace('will-quit'));
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error) => {
    if (error.code !== 'EPIPE') traceError('stdio-error', error);
  });
}

if (IS_DEV && process.env.OPENMTP_REMOTE_DEBUG_PORT) {
  app.commandLine.appendSwitch(
    'remote-debugging-port',
    process.env.OPENMTP_REMOTE_DEBUG_PORT,
  );
}

const isSingleInstance = app.requestSingleInstanceLock();
const isMas = electronIs.mas();
let mainWindow = null;
let usbAttachListener = null;
let usbDetachListener = null;

if (IS_PROD) {
  const sourceMapSupport = require('source-map-support');

  sourceMapSupport.install();
}

if (IS_DEV || DEBUG_PROD) {
  require('electron-debug').default();
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
    traceError('boot-failed', e);
    return false;
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
    productId: device?.productId ?? descriptor.idProduct ?? null,
    vendorId: device?.vendorId ?? descriptor.idVendor ?? null,
    serialNumber: null,
    busNumber: device?.busNumber || null,
    deviceAddress: device?.deviceAddress || null,
  };
}

const pendingDisposals = new WeakMap();
function disposeRendererSession(window) {
  if (pendingDisposals.has(window)) return pendingDisposals.get(window);
  const pending = new Promise((resolve) => {
    let timer;
    const finish = (event) => {
      if (event && event.sender !== window.webContents) return;
      clearTimeout(timer);
      ipcMain.removeListener(
        IpcEvents.APP_BEFORE_QUIT_DISPOSE_MTP_DONE,
        finish,
      );
      trace('renderer-session-disposed', { acknowledged: !!event });
      resolve();
    };
    if (window.isDestroyed() || window.webContents.isDestroyed()) {
      resolve();
      return;
    }
    ipcMain.on(IpcEvents.APP_BEFORE_QUIT_DISPOSE_MTP_DONE, finish);
    timer = setTimeout(finish, 1500);
    try {
      window.webContents.send(IpcEvents.APP_BEFORE_QUIT_DISPOSE_MTP);
    } catch (error) {
      traceError('renderer-dispose-failed', error);
      finish();
    }
  });
  pendingDisposals.set(window, pending);
  return pending;
}

async function createWindow() {
  try {
    if (
      ENV_FLAVOR.allowDevelopmentEnvironment &&
      process.env.OPENMTP_INSTALL_DEVTOOLS === '1'
    ) {
      void installExtensions().catch((error) =>
        traceError('devtools-install-failed', error),
      );
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
        webSecurity: true,
      },
      backgroundColor: getWindowBackgroundColor(),
    });

    const window = mainWindow;
    trace('window-created', { windowId: window.id });
    remote.enable(window.webContents);

    const consoleMessages = new Map();
    mainWindow.webContents.on('console-message', (details) => {
      const shouldLogConsoleMessage =
        process.env.OPENMTP_RENDERER_DIAGNOSTICS === '1' ||
        details.level === 'warning' ||
        details.level === 'error';

      if (!shouldLogConsoleMessage) {
        return;
      }

      const key = details.level + ':' + details.message;
      const count = (consoleMessages.get(key) || 0) + 1;
      if (consoleMessages.size >= 200 && !consoleMessages.has(key))
        consoleMessages.clear();
      consoleMessages.set(key, count);
      if (count > 1 && count % 100 !== 0) return;
      trace('renderer-console', {
        count,
        level: details.level,
        message: details.message,
        source: details.sourceId,
        line: details.lineNumber,
      });
      log.error(
        `[renderer-console:${details.level}] ${details.message} (${details.sourceId}:${details.lineNumber})`,
        'main.dev -> webContents -> console-message',
        true,
        false,
        false,
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
      trace('render-process-gone', details);
      if (!app.quitting && details.reason !== 'clean-exit') {
        dialog.showErrorBox(
          'OpenMTP renderer stopped',
          'The app renderer stopped unexpectedly. Restart OpenMTP. Details have been saved to the local logs.',
        );
        app.exit(1);
      }
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

    window.webContents.on('did-finish-load', () => {
      if (window.isDestroyed()) return;
      trace('did-finish-load', { windowId: window.id });

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

    let disposedForClose = false;
    window.on('close', (event) => {
      if (app.quitting || disposedForClose) return;
      event.preventDefault();
      void disposeRendererSession(window).then(() => {
        disposedForClose = true;
        if (!window.isDestroyed()) window.close();
        return null;
      });
    });

    window.on('closed', () => {
      trace('window-closed', { windowId: window.id });
      if (mainWindow === window) mainWindow = null;
    });

    await window.loadURL(`${PATHS.loadUrlPath}`);
  } catch (e) {
    traceError('window-create-failed', e);
    throw e;
  }
}

/**
 * Checks whether device is ready to boot or not.
 * Here profile files are created if not found.
 */
if (!isSingleInstance) {
  trace('second-instance-exit');
  app.quit();
} else {
  if (IS_PROD) {
    process.on('uncaughtException', (error) => {
      log.error(error, `main.dev -> process -> uncaughtException`);
      dialog.showErrorBox(
        'OpenMTP stopped unexpectedly',
        error.message || String(error),
      );
      app.exit(1);
    });

    appEvents.on('error', (error) => {
      log.error(error, `main.dev -> appEvents -> error`);
    });

    ipcMain.removeAllListeners('ELECTRON_BROWSER_WINDOW_ALERT');
    ipcMain.on('ELECTRON_BROWSER_WINDOW_ALERT', (event, message, title) => {
      log.error(
        message,
        `main.dev -> ipcMain -> on ELECTRON_BROWSER_WINDOW_ALERT -> ${title}`,
      );
      // oxlint-disable-next-line no-param-reassign
      event.returnValue = 0;
    });
  }

  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

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
  ipcMain.on('openmtp.storage-update', (event, request) => {
    try {
      event.returnValue = updateProfileStorage(request, [
        PATHS.settingsFile,
        PATHS.identifierFile,
      ]);
    } catch (error) {
      traceError('storage-update-failed', error);
      event.returnValue = { ok: false, error: error.message };
    }
  });
  ipcMain.on('openmtp.renderer-ready', (_event, details) =>
    trace('renderer-ready', details),
  );

  app
    .whenReady()
    // oxlint-disable-next-line promise/always-return
    .then(async () => {
      try {
        const isDeviceBootable = await bootTheDevice();
        trace(isDeviceBootable ? 'boot-ready' : 'boot-failed');
        if (!isDeviceBootable) {
          const failureWindow = nonBootableDeviceWindow();
          failureWindow.once('closed', () => app.quit());
          return;
        }
        fixSettings();
        await createWindow();

        let appUpdaterEnable = isPackaged;

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
        usbAttachListener = ({ device }) => {
          if (!mainWindow) {
            return;
          }

          mainWindow?.webContents?.send(IpcEvents.USB_HOTPLUG, {
            device: JSON.stringify(normalizeUsbHotplugDevice(device)),
            eventName: USB_HOTPLUG_EVENTS.attach,
          });
        };

        usbDetachListener = ({ device }) => {
          if (!mainWindow) {
            return;
          }

          mainWindow?.webContents?.send(IpcEvents.USB_HOTPLUG, {
            device: JSON.stringify(normalizeUsbHotplugDevice(device)),
            eventName: USB_HOTPLUG_EVENTS.detach,
          });
        };

        usbMonitor.addEventListener('connect', usbAttachListener);
        usbMonitor.addEventListener('disconnect', usbDetachListener);
      } catch (e) {
        traceError('startup-failed', e);
        log.error(e, `main.dev -> whenReady`);
        dialog.showErrorBox('OpenMTP could not start', e?.message || String(e));
        app.exit(1);
        return;
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
      usbMonitor.removeEventListener('connect', usbAttachListener);
      usbAttachListener = null;
    }

    if (usbDetachListener) {
      usbMonitor.removeEventListener('disconnect', usbDetachListener);
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

      void disposeRendererSession(mainWindow).then(() => {
        app.quitting = true;
        return app.quit();
      });

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
