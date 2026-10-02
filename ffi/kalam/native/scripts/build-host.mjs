#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  rmSync,
  renameSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error(
    'This host build targets Apple Silicon macOS. Use build.mjs for other architectures.',
  );
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const native = join(root, 'ffi/kalam/native');
const destination = join(root, 'build/mac/bin/arm64');
const staging = mkdtempSync(join(tmpdir(), 'openmtp-native-build-'));
const target = '13.0';
const buildEnvironment = {
  ...process.env,
  MACOSX_DEPLOYMENT_TARGET: target,
  CGO_CFLAGS: (
    (process.env.CGO_CFLAGS || '') +
    ' -mmacosx-version-min=' +
    target
  ).trim(),
  CGO_LDFLAGS: (
    (process.env.CGO_LDFLAGS || '') +
    ' -mmacosx-version-min=' +
    target
  ).trim(),
};
const cachedPrefix = join(root, 'tmp/libusb-1.0.30-macos13/prefix');
const libusbPrefix =
  process.env.OPENMTP_LIBUSB_PREFIX ||
  (existsSync(join(cachedPrefix, 'lib/pkgconfig/libusb-1.0.pc'))
    ? cachedPrefix
    : null);
if (libusbPrefix)
  buildEnvironment.PKG_CONFIG_PATH = join(libusbPrefix, 'lib/pkgconfig');
const run = (binary, args, options = {}) =>
  execFileSync(binary, args, {
    stdio: 'inherit',
    env: buildEnvironment,
    ...options,
  });
const capture = (binary, args) =>
  execFileSync(binary, args, {
    encoding: 'utf8',
    env: buildEnvironment,
  }).trim();
try {
  const libdir = capture('pkg-config', ['--variable=libdir', 'libusb-1.0']);
  const libusb = realpathSync(join(libdir, 'libusb-1.0.dylib'));
  copyFileSync(libusb, join(staging, 'libusb.dylib'));
  run(
    'go',
    [
      'build',
      '-trimpath',
      '-ldflags=-macos=13.0.0',
      '-buildmode=c-shared',
      '-o',
      join(staging, 'kalam.dylib'),
      '.',
    ],
    { cwd: native },
  );
  run(
    'go',
    [
      'build',
      '-trimpath',
      '-o',
      join(staging, 'kalam_debug_report'),
      './kalam_debug_report',
    ],
    { cwd: native },
  );
  for (const name of ['libusb.dylib', 'kalam.dylib', 'kalam_debug_report']) {
    const path = join(staging, name);
    const minimum = capture('vtool', ['-show-build', path]).match(
      /minos\s+(\d+(?:\.\d+)*)/,
    )?.[1];
    if (!minimum || Number(minimum.split('.')[0]) > 13) {
      throw new Error(
        name +
          ' requires macOS ' +
          minimum +
          '. Supply OPENMTP_LIBUSB_PREFIX built with deployment target13.0.',
      );
    }
    const linkedLibraries = capture('otool', ['-L', path]);
    for (const line of linkedLibraries.split('\n').slice(1)) {
      const linked = line.trim().split(' ')[0];
      if (linked.includes('libusb') && linked !== '@loader_path/libusb.dylib') {
        run('install_name_tool', [
          '-change',
          linked,
          '@loader_path/libusb.dylib',
          path,
        ]);
      }
    }
    if (name.endsWith('.dylib'))
      run('install_name_tool', ['-id', '@loader_path/' + name, path]);
    // install_name_tool invalidates Mach-O signatures. Apple Silicon requires
    // valid local signatures; these are ad-hoc, not Developer ID signatures.
    run('codesign', ['--force', '--sign', '-', path]);
    run('codesign', ['--verify', '--strict', path]);
  }
  // Upstream #481: dyld rejects a chained-fixups segment count that differs
  // from the dylib's segment commands. Verify our rebuilt Go library directly.
  const dylib = readFileSync(join(staging, 'kalam.dylib'));
  if (dylib.readUInt32LE(0) !== 0xfeedfacf)
    throw new Error('Expected a 64-bit Mach-O dylib');
  let segments = 0;
  let fixupSegments;
  let offset = 32;
  for (let index = 0; index < dylib.readUInt32LE(16); index++) {
    const command = dylib.readUInt32LE(offset);
    const size = dylib.readUInt32LE(offset + 4);
    if (size < 8 || offset + size > dylib.length)
      throw new Error('Invalid Mach-O load command');
    if (command === 0x19) segments++;
    if (command === 0x80000034) {
      const fixups = dylib.readUInt32LE(offset + 8);
      const starts = fixups + dylib.readUInt32LE(fixups + 4);
      fixupSegments = dylib.readUInt32LE(starts);
    }
    offset += size;
  }
  if (fixupSegments !== segments) {
    throw new Error(
      `Invalid chained fixups: ${fixupSegments} entries for ${segments} segments. Rebuild with Go >=1.26 (upstream #481).`,
    );
  }
  mkdirSync(destination, { recursive: true });
  for (const name of [
    'kalam.dylib',
    'kalam.h',
    'kalam_debug_report',
    'libusb.dylib',
  ]) {
    const next = join(destination, name + '.next-' + process.pid);
    copyFileSync(join(staging, name), next);
    renameSync(next, join(destination, name));
  }
  console.info(
    `Built native Apple Silicon artifacts with libusb ${capture('pkg-config', ['--modversion', 'libusb-1.0'])} in ${destination}`,
  );
} finally {
  rmSync(staging, { recursive: true, force: true });
}
