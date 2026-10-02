import './guard';
import { expect, mock, test } from 'bun:test';
import { EventEmitter } from 'node:events';

const windows = [];
const enabled = [];
class BrowserWindow extends EventEmitter {
  static getAllWindows() {
    return windows.filter((window) => !window.destroyed);
  }
  constructor(options) {
    super();
    this.options = options;
    this.webContents = new EventEmitter();
    this.title = options.title;
    this.shown = 0;
    this.focused = 0;
    windows.push(this);
  }
  loadURL(url) {
    this.url = url;
  }
  getTitle() {
    return this.title;
  }
  isDestroyed() {
    return !!this.destroyed;
  }
  show() {
    this.shown++;
  }
  focus() {
    this.focused++;
  }
  minimize() {
    this.minimized = true;
  }
  close() {
    this.destroyed = true;
    this.emit('closed');
  }
}
mock.module('electron', () => ({ BrowserWindow }));
mock.module('../../app/helpers/remoteWindowHelpers', () => ({
  getRemoteWindow: () => ({ enable: (contents) => enabled.push(contents) }),
}));
mock.module('../../app/helpers/windowHelper', () => ({
  getWindowBackgroundColor: () => '#123456',
}));
mock.module('../../app/utils/log', () => ({
  log: {
    error: (error) => {
      throw error;
    },
  },
}));
mock.module('../../app/constants/paths', () => ({
  PATHS: { loadUrlPath: 'file:///app/app.html' },
}));
const pages = await import('../../app/helpers/createWindows');
const { PRIVACY_POLICY_PAGE_TITLE } =
  await import('../../app/templates/privacyPolicyPage');

test('each auxiliary page retains its route, geometry, preferences and singleton lifecycle', () => {
  for (const [name, route, width, height, resizable] of [
    ['reportBugsWindow', 'reportBugsPage', 600, 480, false],
    ['privacyPolicyWindow', 'privacyPolicyPage', 800, 600, true],
    ['appFeaturesWindow', 'appFeaturesPage', 800, 630, false],
    ['keyboardShortcutsWindow', 'keyboardShortcutsPage', 800, 600, true],
    ['faqsWindow', 'faqsPage', 920, 800, true],
    [
      'helpPhoneNotConnectingWindow',
      'helpPhoneNotConnectingPage',
      920,
      800,
      true,
    ],
    [
      'appUpdateAvailableWindow',
      'appUpdatePage/updateAvailable',
      650,
      552,
      false,
    ],
  ]) {
    const open = pages[name];
    const window = open();
    expect(window.url).toBe(`file:///app/app.html#${route}`);
    expect(window.options).toMatchObject({
      width,
      height,
      resizable,
      show: false,
      backgroundColor: '#123456',
    });
    expect(window.options.webPreferences).toEqual({
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
    });
    expect(enabled).toContain(window.webContents);
    expect(window.shown).toBe(0);
    window.webContents.emit('did-finish-load');
    expect(window.shown).toBe(1);
    const count = windows.length;
    expect(open()).toBe(window);
    expect(windows.length).toBe(count);
    expect(window.focused).toBe(2);
    window.close();
    const next = open();
    expect(next).not.toBe(window);
    next.close();
    // A late event from a closed window must not focus a replacement.
    window.webContents.emit('did-finish-load');
    expect(window.shown).toBe(2);
  }
});

test('existing titled window is reused without creating a hidden extra window', () => {
  const existing = new BrowserWindow({ title: PRIVACY_POLICY_PAGE_TITLE });
  const count = windows.length;
  expect(pages.privacyPolicyWindow(false, false)).toBe(existing);
  expect(windows.length).toBe(count);
  expect(existing.shown).toBe(0);
  expect(pages.privacyPolicyWindow()).toBe(existing);
  expect(existing.shown).toBe(1);
  existing.close();
});

test('background page waits for an explicit foreground request, renderer use still throws', () => {
  const window = pages.reportBugsWindow(false, false);
  window.webContents.emit('did-finish-load');
  expect(window.shown).toBe(0);
  expect(pages.reportBugsWindow(false, false)).toBe(window);
  expect(window.shown).toBe(0);
  expect(() => pages.reportBugsWindow(true)).toThrow('deprecated');
  expect(pages.reportBugsWindow()).toBe(window);
  expect(window.shown).toBe(1);
  window.close();
});

test('profile recovery window retains minimized-start behavior and inline error page', () => {
  const previous = process.env.START_MINIMIZED;
  process.env.START_MINIMIZED = '1';
  try {
    const window = pages.nonBootableDeviceWindow();
    expect(window.url).toStartWith('data:text/html;charset=utf-8, ');
    expect(window.options).toMatchObject({
      width: 480,
      height: 320,
      minimizable: false,
      maximizable: false,
    });
    window.webContents.emit('did-finish-load');
    expect(window.minimized).toBe(true);
    expect(window.shown).toBe(0);
    window.close();
  } finally {
    if (previous === undefined) delete process.env.START_MINIMIZED;
    else process.env.START_MINIMIZED = previous;
  }
});
