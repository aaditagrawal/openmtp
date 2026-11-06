// Run with Bun. It prepares the committed baseline outside the checkout, then
// measures both versions in the same supported Node/V8 process.
// bun scripts/benchmark-dependency-replacements.mjs
// Requires the baseline commit below in local Git history. Baseline install
// scripts are disabled; its packages never enter the application's manifest.
// OPENMTP_BENCH_FILTER selects workload names with a regular expression.
// OPENMTP_BENCH_OUTPUT selects the JSON checkpoint written after each workload.
// OPENMTP_BENCH_ENV=production selects production React for row-render fixtures.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { promisify } from 'node:util';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

const root = fileURLToPath(new URL('../', import.meta.url));
const base = '9888da15e25b708c62cc2e1d864794804bbf85fb';
const fixture = path.join(os.tmpdir(), `openmtp-dependency-baseline-${base}`);
const selected = new RegExp(process.env.OPENMTP_BENCH_FILTER || '.');
const checkpoint =
  process.env.OPENMTP_BENCH_OUTPUT ||
  path.join(os.tmpdir(), 'openmtp-dependency-benchmark-partial.json');
const readBase = (file) =>
  execFileSync('git', ['show', `${base}:${file}`], {
    cwd: root,
    encoding: 'utf8',
  });

if (!process.env.OPENMTP_BENCH_PREPARED) {
  fs.mkdirSync(fixture, { recursive: true });
  fs.writeFileSync(
    path.join(fixture, 'package.json'),
    readBase('package.json'),
  );
  fs.writeFileSync(path.join(fixture, 'bun.lock'), readBase('bun.lock'));
  const pkg = JSON.parse(readBase('package.json'));
  for (const patch of Object.values(pkg.patchedDependencies)) {
    const target = path.join(fixture, patch);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, readBase(patch));
  }
  execFileSync(
    process.execPath,
    ['install', '--frozen-lockfile', '--ignore-scripts'],
    { cwd: fixture, stdio: ['ignore', 'ignore', 'inherit'] },
  );
  for (const name of ['date', 'checkIf']) {
    let source = readBase(`app/utils/${name}.js`).replace(
      'dayjs/plugin/advancedFormat',
      'dayjs/plugin/advancedFormat.js',
    );
    if (name === 'checkIf')
      source = source
        .replace(
          "'../constants/env'",
          JSON.stringify(path.join(root, 'app/constants/env.js')),
        )
        .replace(
          "'./funcs'",
          JSON.stringify(path.join(root, 'app/utils/funcs.js')),
        );
    fs.writeFileSync(path.join(fixture, `${name}.js`), source);
    for (const [variant, entry] of [
      ['baseline', path.join(fixture, `${name}.js`)],
      ['candidate', path.join(root, `app/utils/${name}.js`)],
    ]) {
      const build = await Bun.build({
        entrypoints: [entry],
        outdir: path.join(fixture, variant),
        naming: `${name}.mjs`,
        target: 'node',
        format: 'esm',
        packages: 'external',
        define: { __dirname: JSON.stringify(path.join(root, 'app/utils')) },
      });
      if (!build.success) throw new Error(build.logs.join('\n'));
    }
  }
  const result = execFileSync('node', [fileURLToPath(import.meta.url)], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    env: {
      ...process.env,
      NODE_ENV: process.env.OPENMTP_BENCH_ENV || 'test',
      TZ: 'America/New_York',
      OPENMTP_BENCH_PREPARED: '1',
    },
    maxBuffer: 8 * 1024 * 1024,
  });
  process.stdout.write(result);
  process.exit(0);
}

const baselineRequire = createRequire(path.join(fixture, 'package.json'));
const baselineDates = await import(
  pathToFileURL(path.join(fixture, 'baseline/date.mjs'))
);
const candidateDates = await import(
  pathToFileURL(path.join(fixture, 'candidate/date.mjs'))
);
const baselineCheck = (
  await import(pathToFileURL(path.join(fixture, 'baseline/checkIf.mjs')))
).checkIf;
const candidateCheck = (
  await import(pathToFileURL(path.join(fixture, 'candidate/checkIf.mjs')))
).checkIf;
const baselineClasses = baselineRequire('classnames');
const candidateClasses = (
  await import(
    'data:text/javascript;base64,' +
      Buffer.from(
        fs.readFileSync(path.join(root, 'app/utils/classNames.js'), 'utf8'),
      ).toString('base64')
  )
).default;
const baselineFs = baselineRequire('fs-extra');
const baselineDayjs = baselineRequire('dayjs');
const baselineMas = baselineRequire('electron-is').mas;
const baselineMasPath = baselineRequire.resolve('electron-is');
const { packageDirectory } = await import(
  pathToFileURL(baselineRequire.resolve('package-directory'))
);
let sink;
const results = [];
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    median: median(values),
    p90: sorted[Math.ceil(values.length * 0.9) - 1],
    min: sorted[0],
    max: sorted.at(-1),
    samples: values,
  };
};
async function measure(name, oldRun, newRun, iterations, asynchronous = false) {
  if (!selected.test(name)) return;
  for (const fn of [oldRun, newRun]) {
    for (let i = 0; i < Math.min(iterations, 100000); i++) {
      if (asynchronous) sink = await fn(i);
      else sink = fn(i);
    }
  }
  const samples = {
    baseline: { cpu: [], wall: [] },
    candidate: { cpu: [], wall: [] },
  };
  for (let round = 0; round < 15; round++) {
    for (const [variant, fn] of round % 2
      ? [
          ['candidate', newRun],
          ['baseline', oldRun],
        ]
      : [
          ['baseline', oldRun],
          ['candidate', newRun],
        ]) {
      const cpu = process.cpuUsage();
      const start = performance.now();
      if (asynchronous) {
        for (let i = 0; i < iterations; i++) sink = await fn(i);
      } else {
        for (let i = 0; i < iterations; i++) sink = fn(i);
      }
      const wall = performance.now() - start;
      const used = process.cpuUsage(cpu);
      samples[variant].cpu.push((used.user + used.system) / iterations);
      samples[variant].wall.push((wall * 1000) / iterations);
    }
  }
  const baseline = {
    cpu_us: stats(samples.baseline.cpu),
    wall_us: stats(samples.baseline.wall),
  };
  const candidate = {
    cpu_us: stats(samples.candidate.cpu),
    wall_us: stats(samples.candidate.wall),
  };
  process.stderr.write(
    `measured ${name} CPU ratio ${candidate.cpu_us.median / baseline.cpu_us.median}\n`,
  );
  results.push({
    name,
    iterations,
    baseline,
    candidate,
    median_cpu_ratio: candidate.cpu_us.median / baseline.cpu_us.median,
  });
  fs.writeFileSync(checkpoint, JSON.stringify(report(false), null, 2));
}

function report(complete) {
  return {
    base,
    complete,
    filter: selected.source,
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpu: os.cpus()[0].model,
      logicalCPUs: os.cpus().length,
      load: os.loadavg(),
      timezone: process.env.TZ,
      nodeEnv: process.env.NODE_ENV,
    },
    methodology:
      'Warm each variant, then 15 alternating baseline/candidate batches. CPU microseconds/op isolate descheduling; wall time includes scheduler and filesystem waits. No startup/install/hardware speed claim.',
    masModuleLoad:
      'Reload only electron-is before each operation, keeping its semver and development-mode dependencies warm. Compare module evaluation plus one mas() call with the replacement source expression. This measures isolated module initialization, not application startup.',
    parityCases,
    classCallSites,
    results,
    sink: typeof sink,
  };
}

// Parity runs before measurements, including unusual accepted date inputs.
const dateInputs = [
  '2020-01-02',
  '2020-01',
  '2020',
  '202001',
  '20200102',
  '20200102T030405',
  '20200102T03',
  '20200102T0304',
  '2020-01-02T03',
  '2020-01-02T0304',
  '2020-01-02T030405',
  '2020/1/2',
  '2020-00-00',
  '2020-02-30',
  '2020-01-02 03:04:05.1',
  '2020-01-02T03:04:05.123Z',
  '2020-01-02T03:04:05+05:30',
  '2024-03-09',
  '2024-03-11',
  '2024-11-02',
  '2024-11-04',
  '',
  'bad date',
  null,
  0,
  new Date(12345),
  new Date(NaN),
];
let parityCases = 0;
for (const tz of [
  'UTC',
  'America/New_York',
  'Asia/Kolkata',
  'Pacific/Auckland',
]) {
  process.env.TZ = tz;
  for (const value of dateInputs) {
    assert.equal(
      candidateDates.appDateFormat(value),
      baselineDates.appDateFormat(value),
    );
    parityCases++;
  }
  for (const start of dateInputs)
    for (const end of dateInputs) {
      assert.equal(
        candidateDates.daysDiff(start, end),
        baselineDates.daysDiff(start, end),
      );
      parityCases++;
    }
}
// Evaluate the actual arguments at every app call site across state combinations.
// This checks CSS strings independently of the helper's implementation.
const { parse } = baselineRequire('@babel/parser');
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc') continue;
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
    else walk(value, visit);
  }
}
const classFiles = fs
  .globSync('app/**/*.{js,jsx}', { cwd: root })
  .filter((file) =>
    /from ['"][^'"]*utils\/classNames['"]/.test(
      fs.readFileSync(path.join(root, file), 'utf8'),
    ),
  );
let classCallSites = 0;
for (const file of classFiles) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
  let local;
  walk(ast, (node) => {
    if (
      node.type === 'ImportDeclaration' &&
      node.source.value.endsWith('/utils/classNames')
    )
      local = node.specifiers[0].local.name;
  });
  walk(ast, (node) => {
    if (node.type !== 'CallExpression' || node.callee.name !== local) return;
    assert.ok(node.arguments.length <= 2, file);
    const args = node.arguments
      .map((arg) => source.slice(arg.start, arg.end))
      .join(',');
    const evaluate = new Function(
      'styles',
      'bold',
      'showLocalPane',
      'isSelected',
      'item',
      'index',
      'a',
      'variant',
      'deviceType',
      'focussedFileExplorerDeviceType',
      'onHoverDropZoneActivate',
      'isStatusBarEnabled',
      'return [' + args + ']',
    );
    for (const prefix of ['css-', '', 'dark-&<>']) {
      const styles = new Proxy(
        {},
        { get: (_, key) => (prefix ? prefix + key : undefined) },
      );
      for (let state = 0; state < 128; state++) {
        const flag = (bit) => Boolean(state & (1 << bit));
        const values = evaluate(
          styles,
          flag(0),
          flag(1),
          flag(2),
          {
            selected: flag(0),
            enabled: flag(1),
            invert: flag(2),
            image: flag(3),
          },
          Number(flag(4)),
          { image: flag(5), name: 'support-logo' },
          'success',
          'mtp',
          { value: flag(6) ? 'mtp' : 'local' },
          () => flag(5),
          flag(4),
        );
        assert.equal(
          candidateClasses(...values),
          baselineClasses(...values),
          file + ':' + node.start,
        );
        parityCases++;
      }
    }
    classCallSites++;
  });
}
assert.ok(classCallSites > 0);
for (const [name, inputs] of [
  ['string', [['css-icon'], [''], [undefined]]],
  [
    'two-strings',
    [
      ['css-success', 'css-root'],
      ['css-icon', 'css-variant'],
    ],
  ],
  [
    'selection',
    [
      ['css-row', { 'css-selected': true }],
      ['css-row', { 'css-selected': false }],
    ],
  ],
  ['flags-only', [[{ 'css-focused': true }], [{ 'css-focused': false }]]],
  [
    'toolbar',
    [
      ['css-toolbar', { disabled: false, inverted: true, image: true }],
      ['css-toolbar', { disabled: true, inverted: false, image: false }],
    ],
  ],
  [
    'large-map',
    [
      [
        'root',
        Object.fromEntries(
          Array.from({ length: 100 }, (_, i) => ['css-' + i, i % 2]),
        ),
      ],
    ],
  ],
]) {
  for (const args of inputs) {
    assert.equal(candidateClasses(...args), baselineClasses(...args));
    parityCases++;
  }
  await measure(
    'classnames/' + name,
    (i) => baselineClasses(...inputs[i % inputs.length]),
    (i) => candidateClasses(...inputs[i % inputs.length]),
    200000,
  );
}
// Keep JSX creation, dynamic flag allocation and React serialization in the measurement.
const { createElement } = baselineRequire('react');
const { renderToStaticMarkup } = baselineRequire('react-dom/server');
function renderRows(classes, count) {
  return renderToStaticMarkup(
    createElement(
      'div',
      { className: 'table' },
      Array.from({ length: count }, (_, i) =>
        createElement(
          'div',
          {
            key: i,
            tabIndex: -1,
            className: classes('css-row', { 'css-selected': i % 3 === 0 }),
          },
          createElement('img', {
            alt: 'File ' + i,
            className: classes('css-icon'),
          }),
        ),
      ),
    ),
  );
}
for (const count of [1, 100, 1000]) {
  assert.equal(
    renderRows(candidateClasses, count),
    renderRows(baselineClasses, count),
  );
  parityCases++;
  await measure(
    'classnames/render-' + count + '-rows',
    () => renderRows(baselineClasses, count),
    () => renderRows(candidateClasses, count),
    count === 1 ? 1000 : count === 100 ? 100 : 10,
  );
}
process.env.TZ = 'America/New_York';
const NativeDate = Date;
const fixedNow = 1793881805123;
globalThis.Date = class extends NativeDate {
  constructor(...args) {
    super(...(args.length ? args : [fixedNow]));
  }
  static now() {
    return fixedNow;
  }
};
for (const name of [
  'yearMonthNow',
  'dateTimeUnixTimestampNow',
  'dateNow',
  'unixTimestampNow',
])
  for (const monthInletters of [true, false]) {
    assert.equal(
      candidateDates[name]({ monthInletters }),
      baselineDates[name]({ monthInletters }),
    );
    parityCases++;
  }
globalThis.Date = NativeDate;
const values = [
  '',
  '1',
  ' 1 ',
  ' ',
  'Infinity',
  '0x10',
  '1e3',
  false,
  null,
  undefined,
  0,
  NaN,
  Infinity,
  {},
  [],
  new Date(),
  () => {},
  Symbol(),
  1n,
];
function outcome(fn, value, condition) {
  try {
    return { value: fn(value, condition) };
  } catch (error) {
    return { error: error.constructor.name };
  }
}
for (const condition of [
  'string',
  'boolean',
  'number',
  'numericString',
  'array',
  'function',
  'object',
  'undefinedOrNull',
  'null',
  'undefined',
])
  for (const value of values) {
    assert.deepEqual(
      outcome(candidateCheck, value, condition),
      outcome(baselineCheck, value, condition),
    );
    parityCases++;
  }
for (const file of [
  'app/main.dev.js',
  'app/containers/Settings/components/SettingsDialog.jsx',
]) {
  assert.match(
    fs.readFileSync(path.join(root, file), 'utf8'),
    /^const isMas = process\.mas === true;$/m,
  );
}
for (const value of [undefined, false, true, 1]) {
  process.mas = value;
  assert.equal(process.mas === true, baselineMas());
  parityCases++;
}
delete process.mas;

for (const [name, inputs] of [
  ['date-object', [new Date(1720000000000)]],
  ['device-local', ['2026-11-05 12:30:00']],
  ['mixed', dateInputs],
])
  await measure(
    `dayjs/${name}`,
    (i) => baselineDates.appDateFormat(inputs[i % inputs.length]),
    (i) => candidateDates.appDateFormat(inputs[i % inputs.length]),
    20000,
  );
await measure(
  'dayjs/log-now',
  () => baselineDates.dateTimeUnixTimestampNow({ monthInletters: true }),
  () => candidateDates.dateTimeUnixTimestampNow({ monthInletters: true }),
  20000,
);
const currentDate = (dates) =>
  [dates.yearMonthNow({}), dates.dateNow({}), dates.unixTimestampNow()].join(
    ' ',
  );
await measure(
  'dayjs/current-date',
  () => currentDate(baselineDates),
  () => currentDate(candidateDates),
  20000,
);
await measure(
  'dayjs/dst-difference',
  () => baselineDates.daysDiff('2024-03-11', '2024-03-09'),
  () => candidateDates.daysDiff('2024-03-11', '2024-03-09'),
  20000,
);
await measure(
  'dayjs/CI-expiry',
  () => baselineDayjs().add(12, 'hour').unix(),
  () => Math.floor((Date.now() + 12 * 3600000) / 1000),
  20000,
);
for (const [name, pairs] of [
  [
    'primitive',
    [
      ['string', '/storage/emulated/0'],
      ['number', 42],
      ['boolean', false],
    ],
  ],
  [
    'mixed',
    [
      ['object', {}],
      ['numericString', '0x10'],
      ['array', []],
      ['function', () => {}],
      ['undefinedOrNull', null],
    ],
  ],
  [
    'invalid',
    [
      ['number', NaN],
      ['object', null],
      ['numericString', ' 1 '],
    ],
  ],
])
  await measure(
    `assertions/${name}`,
    (i) =>
      outcome(
        baselineCheck,
        pairs[i % pairs.length][1],
        pairs[i % pairs.length][0],
      ),
    (i) =>
      outcome(
        candidateCheck,
        pairs[i % pairs.length][1],
        pairs[i % pairs.length][0],
      ),
    20000,
  );
await measure(
  'electron-is/mas',
  () => baselineMas(),
  () => process.mas === true,
  100000,
);
await measure(
  'electron-is/module-load-warm-dependencies',
  () => {
    delete baselineRequire.cache[baselineMasPath];
    return baselineRequire('electron-is').mas();
  },
  () => process.mas === true,
  1000,
);
const fsFixture = fs.mkdtempSync(
  path.join(os.tmpdir(), 'openmtp-filesystem-bench-'),
);
try {
  for (const count of [1, 25, 100]) {
    const payload = JSON.stringify({
      files: Array.from({ length: count }, (_, i) => ({
        name: `file-${i}`,
        path: '/storage/emulated/0/' + 'x'.repeat(count),
        size: i,
      })),
    });
    const dir = path.join(fsFixture, String(count));
    const file = path.join(dir, 'metadata.json');
    const oldRun = () => {
      baselineFs.ensureDirSync(dir, 0o2775);
      baselineFs.outputFileSync(file, payload);
      const parsed = baselineFs.readJsonSync(file);
      baselineFs.removeSync(dir);
      return parsed;
    };
    const newRun = () => {
      fs.mkdirSync(dir, { recursive: true, mode: 0o2775 });
      fs.writeFileSync(file, payload);
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      fs.rmSync(dir, { recursive: true, force: true });
      return parsed;
    };
    assert.deepEqual(newRun(), oldRun());
    await measure(`fs-extra/${count}-records`, oldRun, newRun, 100);
  }
  for (const bytes of [1024, 1024 * 1024]) {
    const file = path.join(fsFixture, `pkgconfig-${bytes}.pc`);
    const payload = `prefix=@@HOMEBREW_CELLAR@@\n${'x'.repeat(bytes)}`;
    const transform = (text) =>
      text.replaceAll('@@HOMEBREW_CELLAR@@', '/tmp/libusb');
    const oldRun = async () => {
      await baselineFs.writeFile(file, payload);
      const text = await baselineFs.readFile(file, 'utf8');
      await baselineFs.writeFile(file, transform(text));
      return baselineFs.readFile(file, 'utf8');
    };
    const newRun = async () => {
      await writeFile(file, payload);
      const text = await readFile(file, 'utf8');
      await writeFile(file, transform(text));
      return readFile(file, 'utf8');
    };
    assert.equal(await newRun(), await oldRun());
    await measure(`fs-extra/async-${bytes}-bytes`, oldRun, newRun, 20, true);
  }
  fs.rmSync(path.join(fsFixture, 'missing'), { recursive: true, force: true });
  const leaf = path.join(fsFixture, 'leaf');
  fs.writeFileSync(leaf, 'file');
  assert.throws(() =>
    fs.mkdirSync(path.join(leaf, 'child'), { recursive: true }),
  );
  assert.throws(() => baselineFs.ensureDirSync(path.join(leaf, 'child')));
} finally {
  fs.rmSync(fsFixture, { recursive: true, force: true });
}
for (const relative of [
  'scripts/cicd/codemagic-publish-builds.mjs',
  'ffi/kalam/native/scripts/build.mjs',
]) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  const expression = source
    .match(/const PKG_ROOT_DIR = ([\s\S]*?);/)[1]
    .replaceAll(
      'import.meta.url',
      JSON.stringify(pathToFileURL(path.join(root, relative)).href),
    );
  const candidateRoot = new Function('fileURLToPath', `return ${expression}`);
  assert.equal(candidateRoot(fileURLToPath), root.replace(/\/$/, ''));
  assert.equal(
    await packageDirectory({ cwd: path.dirname(path.join(root, relative)) }),
    root.replace(/\/$/, ''),
  );
  await measure(
    `package-directory/${relative}`,
    () => packageDirectory(),
    () => candidateRoot(fileURLToPath),
    500,
    true,
  );
}
fs.writeFileSync(checkpoint, JSON.stringify(report(true), null, 2));
console.info(JSON.stringify(report(true), null, 2));
