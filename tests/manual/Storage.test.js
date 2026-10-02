import './guard';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Storage from '../../app/classes/Storage';

const directories = [];
const fixture = () => {
  const directory = mkdtempSync(join(tmpdir(), 'openmtp-storage-'));
  directories.push(directory);
  const path = join(directory, 'settings.json');
  return { path, directory, storage: new Storage(path) };
};
afterEach(() =>
  directories
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true, force: true })),
);

describe('profile storage', () => {
  test('missing settings use defaults and can be written', () => {
    const { storage } = fixture();
    expect(storage.getAll()).toEqual({});
    storage.setItems({ mtpMode: 'kalam', customUi: true });
    storage.setItems({ customUi: false });
    expect(storage.getAll()).toEqual({ mtpMode: 'kalam', customUi: false });
  });

  test('malformed settings do not recurse through logging and preserve a backup', () => {
    const { path, storage } = fixture();
    writeFileSync(path, '{"customUi":');
    expect(storage.getItems(['mtpMode'])).toEqual({});
    expect(readFileSync(path + '.corrupt-backup', 'utf8')).toBe('{"customUi":');
    storage.setItems({ recovered: true });
    expect(storage.getAll()).toEqual({ recovered: true });
    expect(readFileSync(path + '.corrupt-backup', 'utf8')).toBe('{"customUi":');
  });

  test('non-object JSON falls back safely', () => {
    for (const contents of ['null', '[]', '42']) {
      const { path, storage } = fixture();
      writeFileSync(path, contents);
      expect(storage.getItems(['mtpMode'])).toEqual({});
    }
  });

  test('failed serialization preserves the previous file and removes temp files', () => {
    const { storage, directory } = fixture();
    storage.setAll({ customUi: 'preserved' });
    const circular = {};
    circular.self = circular;
    storage.setAll(circular);
    expect(storage.getAll()).toEqual({ customUi: 'preserved' });
    expect(readdirSync(directory)).toEqual(['settings.json']);
  });
});
