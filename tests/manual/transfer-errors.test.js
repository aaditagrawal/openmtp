import './guard.js';
import { expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';

let mode;
let calls;
mock.module('../../app/utils/log', () => ({
  log: { doLog: () => calls.log++ },
}));
mock.module('../../app/utils/usbConflictApps', () => ({
  getActiveUsbConflictApps: async () => {
    calls.probe++;
    return mode === 'conflict' ? ['Preview'] : [];
  },
  formatUsbConflictWarning: (apps) => (apps.length ? 'Close Preview' : null),
  isGoogleAndroidFileTransferActive: async () => {
    calls.aft++;
    return mode === 'aft';
  },
}));
const api = await import('../../app/helpers/processBufferOutput');
// Captured before consolidating the classifiers. Preserve absent flags and
// undefined values as well as text, rule precedence, logging and process probes.
const fixtures = readFileSync(
  new URL('./transfer-errors.jsonl', import.meta.url),
  'utf8',
)
  .trim()
  .split('\n')
  .map(JSON.parse);
for (const fixture of fixtures) {
  test(`${fixture.method}: ${fixture.input.stderr || fixture.input.error || 'success'} ${fixture.mode || ''}`, async () => {
    mode = fixture.mode;
    calls = { log: 0, probe: 0, aft: 0 };
    const result = await api[fixture.method](fixture.input);
    const normalized = JSON.parse(
      JSON.stringify(result, (_, value) =>
        value === undefined ? '__undefined__' : value,
      ),
    );
    expect(normalized).toEqual(fixture.result);
    expect(calls).toEqual(fixture.calls);
  });
}
