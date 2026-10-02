#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('This libusb build targets Apple Silicon macOS.');
}
const version = '1.0.30';
// Published digest of the official release tarball, verified through GitHub's release API.
const expected =
  'fea36f34f9156400209595e300840767ab1a385ede1dc7ee893015aea9c6dbaf';
const root = path.resolve(import.meta.dirname, '../../../..');
const buildRoot = path.join(root, 'tmp', `libusb-${version}-macos13`);
const prefix = path.join(buildRoot, 'prefix');
const library = path.join(prefix, 'lib/libusb-1.0.0.dylib');
const marker = path.join(buildRoot, 'build.json');
const hash = (data) => createHash('sha256').update(data).digest('hex');
try {
  const cached = JSON.parse(await fs.readFile(marker, 'utf8'));
  if (
    cached.sourceSha256 === expected &&
    cached.binarySha256 === hash(await fs.readFile(library))
  ) {
    console.info(`libusb ${version} macOS13 cache verified: ${prefix}`);
    process.exit(0);
  }
} catch {
  /* No verified build cache yet. */
}

await fs.mkdir(buildRoot, { recursive: true });
const archive = path.join(buildRoot, `libusb-${version}.tar.bz2`);
const sourceUrl = `https://github.com/libusb/libusb/releases/download/v${version}/libusb-${version}.tar.bz2`;
let source;
try {
  source = await fs.readFile(archive);
} catch {
  /* Download below. */
}
if (!source || hash(source) !== expected) {
  const response = await fetch(sourceUrl);
  if (!response.ok)
    throw new Error(`libusb download failed: ${response.status}`);
  source = Buffer.from(await response.arrayBuffer());
  if (hash(source) !== expected)
    throw new Error('libusb archive SHA256 mismatch');
  await fs.writeFile(archive, source);
}
const sourceDir = path.join(buildRoot, `libusb-${version}`);
await fs.rm(sourceDir, { recursive: true, force: true });
execFileSync('tar', ['-xjf', archive, '-C', buildRoot], { stdio: 'inherit' });
const env = {
  ...process.env,
  MACOSX_DEPLOYMENT_TARGET: '13.0',
  // SDK27 exposes pipe2; older macOS must use libusb's portable pipe fallback.
  ac_cv_func_pipe2: 'no',
  CFLAGS:
    '-O2 -arch arm64 -mmacosx-version-min=13.0 -Werror=unguarded-availability-new',
  LDFLAGS: '-arch arm64 -mmacosx-version-min=13.0',
};
const run = (command, args) =>
  execFileSync(command, args, { cwd: sourceDir, env, stdio: 'inherit' });
run('./configure', [
  `--prefix=${prefix}`,
  '--disable-static',
  '--enable-shared',
]);
run('make', ['-j4']);
run('make', ['install']);
const buildInfo = execFileSync('vtool', ['-show-build', library], {
  encoding: 'utf8',
});
if (!/minos\s+13\.0\b/.test(buildInfo))
  throw new Error(`Unexpected deployment target: ${buildInfo}`);
const symbols = execFileSync('nm', ['-u', library], { encoding: 'utf8' });
if (/\b_pipe2\b/.test(symbols))
  throw new Error('libusb references macOS27-only pipe2');
await fs.writeFile(
  marker,
  JSON.stringify(
    {
      version,
      minimumMacOS: '13.0',
      sourceUrl,
      sourceSha256: expected,
      binarySha256: hash(await fs.readFile(library)),
      prefix,
    },
    null,
    2,
  ),
);
console.info(`libusb ${version} ready: ${prefix}`);
