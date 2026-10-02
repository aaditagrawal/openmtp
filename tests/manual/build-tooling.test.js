import './guard.js';
import { expect, test } from 'bun:test';
import {
  mkdtemp,
  mkdir,
  readdir,
  rm,
  readFile,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { default as afterPack } from '../../internals/scripts/AfterPack';

test('packaging removes foreign locales while preserving English and other resources', async () => {
  const appOutDir = await mkdtemp(path.join(os.tmpdir(), 'openmtp-pack-'));
  const resources = path.join(appOutDir, 'OpenMTP.app/Contents/Resources');
  try {
    await mkdir(resources, { recursive: true });
    for (const name of ['en.lproj', 'fr.lproj', 'de.lproj', '.hidden.lproj']) {
      await mkdir(path.join(resources, name));
      await writeFile(path.join(resources, name, 'locale.txt'), name);
    }
    await writeFile(path.join(resources, 'app.asar'), 'fixture');
    await afterPack.default({
      appOutDir,
      packager: {
        platform: { name: 'mac' },
        appInfo: { productFilename: 'OpenMTP' },
      },
    });
    expect((await readdir(resources)).sort()).toEqual([
      '.hidden.lproj',
      'app.asar',
      'en.lproj',
    ]);
    await afterPack.default({ packager: { platform: { name: 'linux' } } });
  } finally {
    await rm(appOutDir, { recursive: true, force: true });
  }
});

test('preinstall accepts exactly the supported Node release boundaries before dependencies exist', async () => {
  const source = await readFile(
    new URL('../../internals/scripts/CheckYarn.js', import.meta.url),
    'utf8',
  );
  for (const [node, expected] of [
    ['20.20.0', false],
    ['22.22.0', false],
    ['22.22.1', true],
    ['22.23.0', true],
    ['23.9.0', false],
    ['24.10.9', false],
    ['24.11.0', true],
    ['25.0.0', true],
    ['26.9.0', true],
  ]) {
    let accepted = true;
    try {
      vm.runInNewContext(source, {
        require: () => ({ engines: { node: '^22.22.1 || >=24.11.0' } }),
        process: {
          versions: { node },
          env: { npm_config_user_agent: 'bun/1.4.2' },
          exit() {
            throw new Error('unsupported');
          },
        },
        console: { info() {}, error() {} },
      });
    } catch {
      accepted = false;
    }
    expect(accepted, node).toBe(expected);
  }
});
