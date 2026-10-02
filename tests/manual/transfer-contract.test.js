import './guard.js';
import { expect, mock, test } from 'bun:test';

mock.module(
  '../../app/data/file-explorer/data-sources/FileExplorerLocalDataSource',
  () => ({ FileExplorerLocalDataSource: class {} }),
);
mock.module(
  '../../app/data/file-explorer/data-sources/FileExplorerLegacyDataSource',
  () => ({ FileExplorerLegacyDataSource: class {} }),
);
mock.module(
  '../../app/data/file-explorer/data-sources/FileExplorerKalamDataSource',
  () => ({ FileExplorerKalamDataSource: class {} }),
);
mock.module('../../app/helpers/settings', () => ({
  getMtpModeSetting: () => 'kalam',
}));
const events = [];
mock.module('../../app/services/analytics', () => ({
  analyticsService: { sendEvent: async (...args) => events.push(args) },
}));
mock.module('../../app/helpers/processBufferOutput', () => ({
  processLocalBuffer: ({ error }) => ({ error }),
  processMtpBuffer: ({ error }) => ({ error, mtpStatus: !error }),
}));
const { FileExplorerController } =
  await import('../../app/data/file-explorer/controllers/FileExplorerController');
const { DEVICE_TYPE, MTP_MODE } = await import('../../app/enums');
const noop = () => {};
const cases = {
  initialize: {},
  dispose: {},
  listStorages: {},
  fetchDebugReport: {},
  listFiles: { filePath: '/folder', ignoreHidden: false, storageId: 9 },
  listFilesRecursive: { filePath: '/folder', ignoreHidden: true, storageId: 9 },
  makeDirectory: { filePath: '/folder/new', storageId: 9 },
  renameFile: { filePath: '/folder/file', newFilename: 'new', storageId: 9 },
  deleteFiles: { fileList: ['/folder/file'], storageId: 9 },
  listExistingFiles: { fileList: ['/folder/file'], storageId: 9 },
  filesExist: { fileList: ['/folder/file'], storageId: 9 },
  transferFiles: {
    direction: 'upload',
    destination: '/folder',
    fileList: ['/local/selected'],
    storageId: 9,
    onError: noop,
    onProgress: noop,
    onPreprocess: noop,
    onCompleted: noop,
  },
};

function fixture() {
  const calls = [];
  let mode = MTP_MODE.kalam;
  let result = { error: null, stderr: null, data: true };
  const backends = Object.fromEntries(
    ['local', 'legacy', 'kalam'].map((backend) => [
      backend,
      Object.fromEntries(
        Object.keys(cases).map((operation) => [
          operation,
          async (args) => {
            calls.push({ backend, operation, args });
            return operation === 'listExistingFiles' ? args.fileList : result;
          },
        ]),
      ),
    ]),
  );
  return {
    controller: new FileExplorerController({
      ...backends,
      getMtpMode: () => mode,
    }),
    calls,
    setMode: (value) => {
      mode = value;
    },
    setResult: (value) => {
      result = value;
    },
  };
}

for (const backend of ['local', 'legacy', 'kalam']) {
  test(`${backend}: operation contracts preserve routing, arguments and unsupported cases`, async () => {
    const f = fixture();
    f.setMode(backend);
    for (const [operation, args] of Object.entries(cases)) {
      const unsupported =
        backend === 'local'
          ? [
              'initialize',
              'dispose',
              'listStorages',
              'transferFiles',
              'fetchDebugReport',
            ].includes(operation)
          : backend === 'legacy' && operation === 'initialize';
      const deviceType =
        backend === 'local' ? DEVICE_TYPE.local : DEVICE_TYPE.mtp;
      if (unsupported) {
        await expect(
          f.controller[operation]({ deviceType, ...args }),
        ).rejects.toBe(
          `${operation} for ${backend === 'local' ? 'deviceType=DEVICE_TYPE.local' : 'MTP_MODE.legacy'} is unimplemented`,
        );
        continue;
      }
      const before = f.calls.length;
      const result = await f.controller[operation]({ deviceType, ...args });
      if (backend === 'legacy' && operation === 'dispose') {
        expect(result).toBeUndefined();
        expect(f.calls.length).toBe(before);
        continue;
      }
      const expectedArgs = { ...args };
      if (backend === 'local') delete expectedArgs.storageId;
      if (backend === 'kalam' && operation === 'transferFiles')
        expectedArgs.deviceType = deviceType;
      expect(f.calls.at(-1)).toEqual({
        backend,
        operation:
          backend === 'legacy' && operation === 'listFilesRecursive'
            ? 'listFiles'
            : operation,
        args: expectedArgs,
      });
      expect(result).toEqual(
        operation === 'listExistingFiles'
          ? args.fileList
          : { error: null, stderr: null, data: true },
      );
    }
  });
}

test('mode changes take effect per operation; successful listing skips telemetry', async () => {
  const f = fixture();
  events.length = 0;
  await f.controller.listFiles({
    deviceType: DEVICE_TYPE.mtp,
    ...cases.listFiles,
  });
  f.setMode(MTP_MODE.legacy);
  await f.controller.listFiles({
    deviceType: DEVICE_TYPE.mtp,
    ...cases.listFiles,
  });
  f.setMode('unknown-future-mode');
  await f.controller.listFiles({
    deviceType: DEVICE_TYPE.mtp,
    ...cases.listFiles,
  });
  expect(f.calls.map((call) => call.backend)).toEqual([
    'kalam',
    'legacy',
    'kalam',
  ]);
  expect(events).toEqual([]);
});

test('selection and callback identities survive both transfer directions and backends', async () => {
  const f = fixture();
  for (const mode of [MTP_MODE.kalam, MTP_MODE.legacy]) {
    f.setMode(mode);
    for (const direction of ['upload', 'download']) {
      const args = {
        ...cases.transferFiles,
        direction,
        fileList: ['/one', '/three'],
      };
      await f.controller.transferFiles({
        deviceType: DEVICE_TYPE.mtp,
        ...args,
      });
      expect(f.calls.at(-1).args.fileList).toBe(args.fileList);
      expect(f.calls.at(-1).args.onCompleted).toBe(noop);
      expect(f.calls.at(-1).args.direction).toBe(direction);
    }
  }
});
