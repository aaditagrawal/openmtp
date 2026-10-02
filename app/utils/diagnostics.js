import { appendFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { getAppDataPath } from './files';

const started = performance.now();
const traceFile =
  process.env.OPENMTP_TRACE_FILE ||
  (process.env.OPENMTP_TRACE === '1'
    ? join(getAppDataPath(), 'logs', `diagnostics-${process.pid}.jsonl`)
    : null);

export function trace(event, details = {}) {
  if (!traceFile) return;
  try {
    mkdirSync(dirname(traceFile), { recursive: true });
    appendFileSync(
      traceFile,
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        elapsedMs: Math.round((performance.now() - started) * 100) / 100,
        pid: process.pid,
        processType: process.type || 'node',
        event,
        ...details,
      })}\n`,
      { mode: 0o600 },
    );
  } catch (error) {
    // Diagnostics must remain usable when the settings/profile is damaged.
    console.error('OpenMTP diagnostics write failed:', error.message);
  }
}

export function traceError(event, error) {
  trace(event, {
    message: error?.message || String(error),
    stack: error?.stack,
  });
}
