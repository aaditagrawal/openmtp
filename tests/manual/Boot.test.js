import './guard';
import { afterEach, expect, test } from 'bun:test';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Boot from '../../app/classes/Boot';

const directories = [];
const fixture = () => {
  const path = mkdtempSync(join(tmpdir(), 'openmtp-boot-'));
  directories.push(path);
  const boot = new Boot();
  boot.verifyDirList = [join(path, 'profile', 'logs')];
  boot.settingsFile = join(path, 'profile', 'settings.json');
  boot.verifyFileList = [
    join(boot.verifyDirList[0], 'error.log'),
    boot.settingsFile,
  ];
  return boot;
};
afterEach(() =>
  directories
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true, force: true })),
);

test('fresh boot awaits files and quick verification succeeds after initialization', async () => {
  const boot = fixture();
  expect(boot.quickVerify()).toBe(false);
  expect(await boot.init()).toBe(true);
  expect(await boot.verify()).toBe(true);
  expect(boot.quickVerify()).toBe(true);
  expect(JSON.parse(readFileSync(boot.settingsFile, 'utf8'))).toEqual({});
});

test('profile initialization preserves existing custom settings', async () => {
  const boot = fixture();
  mkdirSync(boot.verifyDirList[0], { recursive: true });
  writeFileSync(boot.settingsFile, '{"customUi":true}');
  await boot.init();
  await boot.createFile(boot.settingsFile);
  expect(readFileSync(boot.settingsFile, 'utf8')).toBe('{"customUi":true}');
});

test('verification checks all required directories', async () => {
  const boot = fixture();
  await boot.init();
  boot.verifyDirList.push(join(boot.verifyDirList[0], 'missing'));
  expect(await boot.verify()).toBe(false);
});
