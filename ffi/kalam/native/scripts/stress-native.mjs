#!/usr/bin/env node
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

if (process.env.CI) throw new Error('Native stress tests are local-only');

const require = createRequire(import.meta.url);
const koffi = require('koffi');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const libraryPath =
  process.env.OPENMTP_STRESS_LIBRARY ||
  join(root, 'build/mac/bin/arm64/kalam.dylib');
const iterations = Number(process.env.OPENMTP_STRESS_ITERATIONS || 100);
const library = koffi.load(libraryPath);
const callbackType = koffi.proto('void OpenmtpStressResult(char*)');
const functions = {
  Initialize: library.func('void Initialize(OpenmtpStressResult*)'),
  Dispose: library.func('void Dispose(OpenmtpStressResult*)'),
};
const invoke = (name) =>
  new Promise((resolve, reject) => {
    let result;
    let responseError;
    const pointer = koffi.register((value) => {
      try {
        result = JSON.parse(value);
      } catch (error) {
        responseError = error;
      }
    }, koffi.pointer(callbackType));
    try {
      functions[name].async(pointer, (error) => {
        koffi.unregister(pointer);
        if (error || responseError) reject(error || responseError);
        else resolve(result);
      });
    } catch (error) {
      koffi.unregister(pointer);
      reject(error);
    }
  });
const sample = (iteration) => {
  global.gc?.();
  const threads =
    execFileSync('ps', ['-M', '-p', String(process.pid)], { encoding: 'utf8' })
      .trim()
      .split('\n').length - 1;
  let fileDescriptors = null;
  try {
    fileDescriptors = execFileSync(
      '/usr/sbin/lsof',
      ['-a', '-p', String(process.pid), '-Ff'],
      { encoding: 'utf8' },
    )
      .split('\n')
      .filter((line) => /^f\d/.test(line)).length;
  } catch {
    /* Metrics may be restricted on another host. */
  }
  return {
    iteration,
    threads,
    fileDescriptors,
    rssBytes: process.memoryUsage().rss,
  };
};
const samples = [];
const started = performance.now();
for (let iteration = 0; iteration < iterations; iteration += 1) {
  const result = await invoke('Initialize');
  const disposed = await invoke('Dispose');
  if (!result.error)
    throw new Error(
      'MTP device is attached; disconnected stress stopped after releasing the session',
    );
  if (disposed.error) throw new Error(String(disposed.error));
  if (
    iteration === 4 ||
    iteration === Math.floor(iterations / 2) ||
    iteration === iterations - 1
  )
    samples.push(sample(iteration + 1));
}
const report = {
  libraryPath,
  iterations,
  durationMs: performance.now() - started,
  samples,
};
console.info(JSON.stringify(report, null, 2));
if (process.argv[2])
  writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n');

// A loaded Go shared runtime owns background threads until process exit.
process.exit(0);
