/**
 * Bun preload so unit tests can import modules that transitively touch Electron.
 * Electron's package entry does not export renderer/main APIs under bun:test.
 */
import { mock } from 'bun:test';

mock.module('electron', () => ({
  app: {
    getPath: () => '/tmp',
    getName: () => 'OpenMTP',
    getVersion: () => '0.0.0',
  },
  ipcRenderer: {
    on: () => {},
    once: () => {},
    removeListener: () => {},
    send: () => {},
  },
  ipcMain: {
    on: () => {},
    handle: () => {},
  },
  shell: {
    openExternal: async () => {},
    openPath: async () => '',
  },
  nativeTheme: {
    shouldUseDarkColors: false,
    on: () => {},
  },
  BrowserWindow: class BrowserWindow {},
  Menu: {
    buildFromTemplate: () => ({ popup: () => {} }),
  },
}));
