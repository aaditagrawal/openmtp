import './guard';
import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveRuntimePaths } from '../../app/utils/runtimePaths';

const roots = [];
const fixture = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'openmtp-paths-'));
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

test('development resolves package root from source or emitted app files, independent of cwd', () => {
  const root = fixture();
  writeFileSync(path.join(root, 'package.json'), '{}');
  const source = path.join(root, 'app', 'utils');
  mkdirSync(source, { recursive: true });
  for (const startDirectory of [source, path.join(root, 'app')]) {
    expect(
      resolveRuntimePaths({
        electronVersion: '',
        resourcesPath: '',
        startDirectory,
      }),
    ).toEqual({ isPackaged: false, rootPath: root });
  }
});

test('packaged app locates external native resources instead of ASAR or cwd', () => {
  const root = fixture();
  const bundle = path.join(root, 'OpenMTP.app');
  const resourcesPath = path.join(bundle, 'Contents', 'Resources');
  mkdirSync(resourcesPath, { recursive: true });
  writeFileSync(path.join(resourcesPath, 'app.asar'), 'archive');
  expect(
    resolveRuntimePaths({
      electronVersion: '44.5.1',
      resourcesPath,
      startDirectory: '/irrelevant',
    }),
  ).toEqual({ isPackaged: true, rootPath: bundle });
});

test('Electron development distribution with default_app.asar is not a packaged OpenMTP', () => {
  const root = fixture();
  writeFileSync(path.join(root, 'package.json'), '{}');
  writeFileSync(path.join(root, 'default_app.asar'), 'archive');
  expect(
    resolveRuntimePaths({
      electronVersion: '44.5.1',
      resourcesPath: root,
      startDirectory: root,
    }),
  ).toEqual({ isPackaged: false, rootPath: root });
});
