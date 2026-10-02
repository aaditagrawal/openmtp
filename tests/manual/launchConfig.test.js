import './guard';
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dir, '../..');
const scriptDir = path.join(root, 'internals/scripts');

test('GUI launcher removes inherited Node mode/preloads while preserving diagnostics and app arguments', () => {
  const child = new EventEmitter();
  const killed = [];
  child.kill = (signal) => killed.push(signal);
  const host = new EventEmitter();
  host.env = {
    ELECTRON_RUN_AS_NODE: '1',
    NODE_OPTIONS: '--require invalid-host-preload',
    OPENMTP_TRACE_DIR: '/tmp/trace',
    PATH: '/bin',
  };
  host.argv = [
    'node',
    'run-electron.js',
    './app/main.prod.js',
    '--enable-logging',
  ];
  let launch;
  vm.runInNewContext(
    readFileSync(path.join(scriptDir, 'run-electron.js'), 'utf8'),
    {
      __dirname: scriptDir,
      process: host,
      console,
      require: (id) => {
        if (id === 'node:child_process')
          return {
            spawn: (...args) => {
              launch = args;
              return child;
            },
          };
        if (id === 'node:path') return path;
        if (id === 'electron') return '/Electron.app/Contents/MacOS/Electron';
        throw new Error(`Unexpected import: ${id}`);
      },
    },
  );
  expect(launch[0]).toBe('/Electron.app/Contents/MacOS/Electron');
  expect(Array.from(launch[1])).toEqual([
    './app/main.prod.js',
    '--enable-logging',
  ]);
  expect({ ...launch[2].env }).toEqual({
    OPENMTP_TRACE_DIR: '/tmp/trace',
    PATH: '/bin',
  });
  expect(launch[2].cwd).toBe(root);
  expect(host.env.ELECTRON_RUN_AS_NODE).toBe('1');
  host.emit('SIGTERM');
  expect(killed).toEqual(['SIGTERM']);
  child.emit('exit', 7, null);
  expect(host.exitCode).toBe(7);
});

const resolvePort = (port, production) => {
  const result = { exports: {} };
  vm.runInNewContext(
    readFileSync(path.join(root, 'config/env/index.js'), 'utf8'),
    {
      module: result,
      process: { env: port === undefined ? {} : { PORT: port } },
      require: (id) =>
        id.includes('constants/env')
          ? { IS_PROD: production }
          : { PORT: id === './env.prod' ? 8000 : 4642 },
    },
  );
  return result.exports.PORT;
};

test('explicit requested port wins in development and production', () => {
  expect(resolvePort('5231', false)).toBe(5231);
  expect(resolvePort('5231', true)).toBe(5231);
  expect(resolvePort(undefined, false)).toBe(4642);
  expect(resolvePort(undefined, true)).toBe(8000);
});

test('invalid requested ports fail before starting the development server', () => {
  for (const port of ['abc', '-1', '65536', '3.2'])
    expect(() => resolvePort(port, false)).toThrow('PORT must be an integer');
});
