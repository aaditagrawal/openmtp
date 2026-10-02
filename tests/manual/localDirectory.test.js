import './guard';
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import {
  mapConcurrent,
  readDirectoryEntries,
  readDirectoryTree,
} from '../../app/utils/localDirectory';

const roots = [];
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'openmtp-directory-'));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('local directory IO', () => {
  test('bounds concurrency and retains input order', async () => {
    let active = 0;
    let peak = 0;
    const result = await mapConcurrent(
      [5, 4, 3, 2, 1],
      async (value) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, value));
        active -= 1;
        return value * 2;
      },
      2,
    );
    expect(result).toEqual([10, 8, 6, 4, 2]);
    expect(peak).toBe(2);
  });

  test('resolves relative symlinks against their own directory', async () => {
    const root = await fixture();
    await mkdir(path.join(root, 'folder'));
    await writeFile(path.join(root, 'photo.jpg'), 'photo');
    await writeFile(path.join(root, '.secret'), 'hidden');
    await symlink('folder', path.join(root, 'alias'));
    await symlink('missing', path.join(root, 'broken'));
    const entries = await readDirectoryEntries(root, { ignoreHidden: true });
    expect(entries.map((entry) => entry.name).sort()).toEqual([
      'alias',
      'folder',
      'photo.jpg',
    ]);
    const alias = entries.find((entry) => entry.name === 'alias');
    expect(alias.isFolder).toBe(true);
    expect(alias.symlink.endsWith('/folder')).toBe(true);
    expect(entries.find((entry) => entry.name === 'photo.jpg').size).toBe(5);
  });

  test('fails closed on symlink cycles instead of hanging Smart Sync', async () => {
    const root = await fixture();
    await mkdir(path.join(root, 'nested'));
    await symlink('..', path.join(root, 'nested', 'back'));
    await expect(readDirectoryTree(root)).rejects.toMatchObject({
      code: 'ELOOP',
    });
  });

  test('lists nested file metadata and reports a file root as ENOTDIR', async () => {
    const root = await fixture();
    await mkdir(path.join(root, 'nested'));
    const file = path.join(root, 'nested', 'data.txt');
    await writeFile(file, 'data');
    const entries = await readDirectoryTree(root);
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe(file);
    expect(entries[0].mtimeMs).toBeGreaterThan(0);
    await expect(readDirectoryTree(file)).rejects.toMatchObject({
      code: 'ENOTDIR',
    });
  });
});

test('lists each sibling alias without treating shared targets as cycles', async () => {
  const root = await fixture();
  await mkdir(path.join(root, 'target'));
  await writeFile(path.join(root, 'target', 'data.txt'), 'same target');
  await symlink('target', path.join(root, 'alias-a'));
  await symlink('target', path.join(root, 'alias-b'));
  const files = await readDirectoryTree(root);
  expect(files.map((file) => path.relative(root, file.path)).sort()).toEqual([
    'alias-a/data.txt',
    'alias-b/data.txt',
    'target/data.txt',
  ]);
});

test('rejects self and indirect directory cycles with the offending path', async () => {
  const root = await fixture();
  const self = path.join(root, 'self');
  await symlink('.', self);
  await expect(readDirectoryTree(root)).rejects.toMatchObject({
    code: 'ELOOP',
    message: `Directory symlink cycle: ${self}`,
  });
  await rm(self);
  await mkdir(path.join(root, 'a'));
  await mkdir(path.join(root, 'b'));
  await symlink('../b', path.join(root, 'a', 'to-b'));
  await symlink('../a', path.join(root, 'b', 'to-a'));
  await expect(readDirectoryTree(root)).rejects.toMatchObject({
    code: 'ELOOP',
  });
});

test('retains filesystem sibling order and breadth-first traversal', async () => {
  const root = await fixture();
  for (const directory of ['left', 'right']) {
    await mkdir(path.join(root, directory, 'deep'), { recursive: true });
    await writeFile(path.join(root, directory, 'first.txt'), directory);
    await writeFile(path.join(root, directory, 'deep', 'last.txt'), directory);
  }
  await writeFile(path.join(root, 'root.txt'), 'root');
  const siblings = (await readDirectoryEntries(root)).filter(
    (entry) => entry.isFolder,
  );
  const expected = [path.join(root, 'root.txt')];
  for (const sibling of siblings)
    expected.push(path.join(sibling.path, 'first.txt'));
  for (const sibling of siblings)
    expected.push(path.join(sibling.path, 'deep', 'last.txt'));
  expect((await readDirectoryTree(root)).map((entry) => entry.path)).toEqual(
    expected,
  );
});

test('walks a bounded deep tree and detects a link back to a distant ancestor', async () => {
  const root = await fixture();
  let current = root;
  const expected = [];
  for (let depth = 0; depth < 80; depth++) {
    current = path.join(current, 'd');
    await mkdir(current);
    const file = path.join(current, 'file.txt');
    await writeFile(file, String(depth));
    expected.push(file);
  }
  expect((await readDirectoryTree(root)).map((entry) => entry.path)).toEqual(
    expected,
  );
  const backlink = path.join(current, 'root');
  await symlink(root, backlink);
  await expect(readDirectoryTree(root)).rejects.toMatchObject({
    code: 'ELOOP',
    message: `Directory symlink cycle: ${backlink}`,
  });
});
