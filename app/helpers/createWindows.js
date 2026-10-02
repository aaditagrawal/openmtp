import { BrowserWindow } from 'electron';
import { PATHS } from '../constants/paths';
import { log } from '../utils/log';
import { loadProfileErrorHtml } from '../templates/loadProfileError';
import { APP_TITLE } from '../constants/meta';
import { PRIVACY_POLICY_PAGE_TITLE } from '../templates/privacyPolicyPage';
import {
  FAQS_PAGE_TITLE,
  HELP_PHONE_IS_NOT_CONNECTING,
} from '../templates/helpFaqsPage';
import { APP_FEATURES_PAGE_TITLE } from '../templates/appFeaturesPage';
import { KEYBOARD_SHORTCUTS_PAGE_TITLE } from '../templates/keyboardShortcutsPage';
import { REPORT_BUGS_PAGE_TITLE } from '../templates/generateErrorReport';
import { getWindowBackgroundColor } from './windowHelper';
import { getRemoteWindow } from './remoteWindowHelpers';

const remote = getRemoteWindow();
const showWindow = (window) => {
  window.show();
  window.focus();
};

const createWindow = (options) => {
  const window = new BrowserWindow({
    title: APP_TITLE,
    show: false,
    resizable: false,
    minimizable: true,
    fullscreenable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
    },
    backgroundColor: getWindowBackgroundColor(),
    ...options,
  });
  remote.enable(window.webContents);
  return window;
};

// Keep the historical public argument positions. Renderer callers must use IPC.
const pageWindow = (route, title, options) => {
  let current = null;
  return (isRenderedPage = false, focus = true) => {
    if (isRenderedPage) {
      throw new Error(
        "'isRenderedPage' param is deprecated. Use ipcRenderer.send(IpcEvents.OPEN_<***>_WINDOW) to open a window from a renderer",
      );
    }
    try {
      if (current?.isDestroyed()) current = null;
      const existing =
        current ||
        (title &&
          BrowserWindow.getAllWindows().find((window) =>
            window.getTitle().includes(title),
          ));
      if (existing) {
        if (focus) showWindow(existing);
        return existing;
      }

      const window = createWindow(options);
      current = window;
      window.on('closed', () => {
        if (current === window) current = null;
      });
      window.webContents.on('did-finish-load', () => {
        if (focus && !window.isDestroyed()) showWindow(window);
      });
      window.onerror = (error) => log.error(error, `createWindows -> ${route}`);
      window.loadURL(`${PATHS.loadUrlPath}#${route}`);
      return window;
    } catch (error) {
      log.error(error, `createWindows -> ${route}`);
    }
  };
};

const resizableOptions = {
  resizable: true,
  fullscreenable: true,
  minWidth: 600,
  minHeight: 400,
};

export const reportBugsWindow = pageWindow(
  'reportBugsPage',
  REPORT_BUGS_PAGE_TITLE,
  {
    width: 600,
    height: 480,
    minimizable: false,
  },
);

export const privacyPolicyWindow = pageWindow(
  'privacyPolicyPage',
  PRIVACY_POLICY_PAGE_TITLE,
  {
    ...resizableOptions,
    width: 800,
    height: 600,
  },
);

export const appFeaturesWindow = pageWindow(
  'appFeaturesPage',
  APP_FEATURES_PAGE_TITLE,
  {
    width: 800,
    height: 630,
  },
);

export const keyboardShortcutsWindow = pageWindow(
  'keyboardShortcutsPage',
  KEYBOARD_SHORTCUTS_PAGE_TITLE,
  {
    ...resizableOptions,
    width: 800,
    height: 600,
  },
);

export const faqsWindow = pageWindow('faqsPage', FAQS_PAGE_TITLE, {
  ...resizableOptions,
  width: 920,
  height: 800,
});

export const helpPhoneNotConnectingWindow = pageWindow(
  'helpPhoneNotConnectingPage',
  HELP_PHONE_IS_NOT_CONNECTING,
  {
    ...resizableOptions,
    width: 920,
    height: 800,
  },
);

export const appUpdateAvailableWindow = pageWindow(
  'appUpdatePage/updateAvailable',
  null,
  {
    width: 650,
    height: 552,
  },
);

export const nonBootableDeviceWindow = () => {
  const window = createWindow({
    center: true,
    maximizable: false,
    minimizable: false,
    width: 480,
    height: 320,
  });
  window.webContents.on('did-finish-load', () => {
    if (window.isDestroyed()) return;
    if (process.env.START_MINIMIZED) window.minimize();
    else showWindow(window);
  });
  window.loadURL(
    `data:text/html;charset=utf-8, ${encodeURI(loadProfileErrorHtml)}`,
  );
  return window;
};
