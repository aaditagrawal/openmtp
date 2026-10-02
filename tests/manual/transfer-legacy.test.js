import './guard.js';
import { expect, mock, test } from 'bun:test';
mock.module('../../app/utils/log', () => ({ log: { error() {} } }));
mock.module('../../app/helpers/binaries', () => ({
  mtpCliPath: '/unused/mtp-cli',
}));
const { FileExplorerLegacyDataSource } =
  await import('../../app/data/file-explorer/data-sources/FileExplorerLegacyDataSource');

function row(name, type = '3000') {
  return `1 2 ${type} 0 2026-10-02 12:30:00  ${name}`;
}

test('legacy listing preserves first row and order while deduplicating large results', async () => {
  const source = new FileExplorerLegacyDataSource();
  const names = Array.from({ length: 10000 }, (_, i) => `file ${i}.txt`);
  source._exec = async () => ({
    error: null,
    stderr: null,
    data: [
      'Selected storage 1',
      'malformed row',
      row('.hidden'),
      row('folder', '3001'),
      ...names.map((name) => row(name)),
      row('folder', '3000'),
      ...names.map((name) => row(name)),
    ].join('\n'),
  });
  const result = await source.listFiles({
    filePath: '/root',
    ignoreHidden: true,
    storageId: 1,
  });
  expect(result.error).toBeNull();
  expect(result.data.length).toBe(10001);
  expect(result.data[0]).toMatchObject({
    name: 'folder',
    path: '/root/folder',
    isFolder: true,
  });
  expect(result.data.slice(1).map((entry) => entry.name)).toEqual(names);
  expect(result.data[1].dateAdded).toBe('2026-10-02 12:30:00');
  const withHidden = await source.listFiles({
    filePath: '/root',
    ignoreHidden: false,
    storageId: 1,
  });
  expect(withHidden.data[0].name).toBe('.hidden');
});

test('legacy executor keeps stdout and distinguishes raw errors from cleaned output', async () => {
  const source = new FileExplorerLegacyDataSource();
  source.execPromise = async () => ({
    stdout: 'listing',
    stderr: 'Device::Find failed\n',
  });
  expect(await source._exec('inert')).toEqual({
    data: 'listing',
    error: null,
    stderr: null,
  });
  const failure = Object.assign(new Error('transfer failure'), {
    stdout: 'partial listing',
    stderr: 'Device::Find failed\npermission denied',
  });
  source.execPromise = async () => {
    throw failure;
  };
  const filtered = await source._exec('inert');
  expect(filtered).toEqual({
    data: 'partial listing',
    error: 'Error: transfer failure',
    stderr: 'permission denied',
  });
  const raw = await source._execNoCatch('inert');
  expect(raw.error).toBe(failure);
  expect(raw.stderr).toBe(failure.stderr);
  expect(raw.data).toBe('partial listing');
});

test('legacy executor actually completes a harmless subprocess without extra callbacks', async () => {
  const source = new FileExplorerLegacyDataSource();
  expect(await source._exec('printf listing')).toEqual({
    data: 'listing',
    stderr: null,
    error: null,
  });
  const failed = await source._execNoCatch(
    'printf partial; printf failed >&2; exit 7',
  );
  expect(failed.data).toBe('partial');
  expect(failed.stderr).toBe('failed');
  expect(failed.error.code).toBe(7);
});

test('legacy storages preserve selected-first-row and duplicate-ID behavior', async () => {
  const source = new FileExplorerLegacyDataSource();
  source._exec = async () => ({
    error: null,
    stderr: null,
    data: '1 description: Internal\n2 description: SD card\n1 description: Updated',
  });
  expect(await source.listStorages()).toEqual({
    error: null,
    stderr: null,
    data: {
      1: { name: 'Updated', selected: false },
      2: { name: 'SD card', selected: false },
    },
  });
  source._exec = async () => ({
    error: null,
    stderr: null,
    data: '7 description: Internal',
  });
  expect((await source.listStorages()).data[7].selected).toBe(true);
});
