import './guard';
import { expect, mock, test } from 'bun:test';

mock.module('../../app/utils/log', () => ({ log: { error: () => {} } }));

mock.module('../../app/helpers/settings', () => ({
  getFilesPreprocessingBeforeTransferSetting: () => true,
}));

let loads = 0;
let shouldFail = false;
mock.module('../../ffi/kalam/src/Kalam', () => ({
  Kalam: class Kalam {
    constructor() {
      loads += 1;
      if (shouldFail) throw new Error('Native library unavailable');
    }
    async initialize() {
      return { error: null, stderr: null, data: true };
    }
    async dispose() {
      return { error: null, stderr: null, data: true };
    }
  },
}));

const { FileExplorerKalamDataSource } =
  await import('../../app/data/file-explorer/data-sources/FileExplorerKalamDataSource');

test('constructing a local/help renderer and disposing does not load native MTP', async () => {
  const before = loads;
  const source = new FileExplorerKalamDataSource();
  expect(loads).toBe(before);
  expect(await source.dispose()).toEqual({
    error: null,
    stderr: null,
    data: true,
  });
  expect(loads).toBe(before);
});

test('MTP initializes lazily once and reuses its session', async () => {
  const before = loads;
  const source = new FileExplorerKalamDataSource();
  expect((await source.initialize()).data).toBe(true);
  expect((await source.initialize()).data).toBe(true);
  expect(loads).toBe(before + 1);
});

test('a native library load failure is an operation error, and retry can recover', async () => {
  const source = new FileExplorerKalamDataSource();
  shouldFail = true;
  const result = await source.initialize();
  expect(result.error.message).toBe('Native library unavailable');
  expect(result.data).toBe(null);
  shouldFail = false;
  expect((await source.initialize()).data).toBe(true);
});
