import './guard';
import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { updateProfileStorage } from '../../app/helpers/storageIpc';

const temporary = [];
afterEach(() =>
  temporary
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true, force: true })),
);

test('successive renderer updates preserve both sets of settings', () => {
  const directory = mkdtempSync(join(tmpdir(), 'openmtp-storage-ipc-'));
  temporary.push(directory);
  const path = join(directory, 'settings.json');
  for (const data of [{ uiTheme: 'dark' }, { mtpMode: 'kalam' }]) {
    expect(
      updateProfileStorage({ filePath: path, method: 'setItems', data }, [
        path,
      ]),
    ).toEqual({ ok: true });
  }
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
    uiTheme: 'dark',
    mtpMode: 'kalam',
  });
});

test('storage IPC rejects unknown paths and methods', () => {
  expect(
    updateProfileStorage(
      { filePath: '/tmp/unrelated', method: 'setAll', data: {} },
      ['/tmp/settings'],
    ),
  ).toEqual({ ok: false, error: 'Invalid profile storage request' });
  expect(
    updateProfileStorage(
      { filePath: '/tmp/settings', method: 'constructor', data: {} },
      ['/tmp/settings'],
    ).ok,
  ).toBe(false);
  expect(updateProfileStorage(null, ['/tmp/settings']).ok).toBe(false);
});
