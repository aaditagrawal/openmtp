import './guard';
import { expect, mock, test } from 'bun:test';

const calls = [];
let result;
const controller = Object.fromEntries(
  ['renameFile', 'makeDirectory', 'listFiles'].map((method) => [
    method,
    async (args) => {
      calls.push({ method, args });
      if (method === 'listFiles')
        return { data: [], error: null, stderr: null };
      if (result instanceof Error) throw result;
      return result;
    },
  ]),
);
mock.module(
  '../../app/data/file-explorer/controllers/FileExplorerController',
  () => ({ default: controller }),
);
mock.module('../../app/helpers/processBufferOutput', () => ({
  processLocalBuffer: (args) => {
    calls.push({ method: 'localError', args });
    return { error: args.error };
  },
  processMtpBuffer: async (args) => {
    calls.push({ method: 'mtpError', args });
    return { mtpStatus: true, error: args.error };
  },
}));
mock.module('../../app/utils/log', () => ({
  log: { error: (error) => calls.push({ method: 'log', error }) },
}));
mock.module('../../app/services/analytics', () => ({
  analyticsService: { sendEvent() {} },
}));
const { renameDirectoryEntry, createDirectory } =
  await import('../../app/containers/HomePage/actions');

async function run(action, mode = 'kalam') {
  const state = {
    Settings: { mtpMode: mode },
    Home: {
      mtpStoragesList: { 42: { selected: true } },
      mtpDevice: {},
      currentBrowsePath: {},
      directoryLists: {},
    },
  };
  const pending = [];
  const getState = () => state;
  const dispatch = (value) => {
    if (typeof value === 'function') {
      const next = value(dispatch, getState);
      if (next?.then) pending.push(next);
      return next;
    }
    return value;
  };
  await action(dispatch, getState);
  while (pending.length) await Promise.all(pending.splice(0));
}
const listing = { filePath: '/destination', ignoreHidden: false };
for (const deviceType of ['local', 'mtp']) {
  for (const [method, action, args] of [
    [
      'renameFile',
      renameDirectoryEntry,
      { filePath: '/old', newFilename: 'new' },
    ],
    ['makeDirectory', createDirectory, { newFolderPath: '/new' }],
  ]) {
    test(`${deviceType} ${method} retains storage, backend error handling and one success refresh`, async () => {
      calls.length = 0;
      result = { error: null, stderr: null, data: true };
      await run(action({ ...args, deviceType }, listing));
      expect(calls[0]).toEqual({
        method,
        args: {
          ...(method === 'renameFile' ? args : { filePath: '/new' }),
          deviceType,
          storageId: deviceType === 'mtp' ? 42 : null,
        },
      });
      expect(calls.filter((call) => call.method === 'listFiles')).toEqual([
        {
          method: 'listFiles',
          args: {
            ...listing,
            deviceType,
            storageId: deviceType === 'mtp' ? 42 : null,
          },
        },
      ]);
      expect(calls[1].method).toBe(
        deviceType === 'mtp' ? 'mtpError' : 'localError',
      );
      if (deviceType === 'mtp') expect(calls[1].args.mtpMode).toBe('kalam');

      calls.length = 0;
      result = {
        error: 'permission denied',
        stderr: 'backend detail',
        data: false,
      };
      await run(action({ ...args, deviceType }, listing), 'legacy');
      expect(calls.some((call) => call.method === 'listFiles')).toBe(false);
      expect(calls[1].args.error).toBe('permission denied');
      if (deviceType === 'mtp') expect(calls[1].args.mtpMode).toBe('legacy');
    });
  }
}

test('mutation exceptions are logged and unsupported panes do not call adapters', async () => {
  calls.length = 0;
  result = new Error('adapter rejected');
  await run(
    createDirectory({ newFolderPath: '/new', deviceType: 'local' }, listing),
  );
  expect(calls.map((call) => call.method)).toEqual(['makeDirectory', 'log']);
  calls.length = 0;
  await run(
    createDirectory({ newFolderPath: '/new', deviceType: 'invalid' }, listing),
  );
  expect(calls).toEqual([]);
});
