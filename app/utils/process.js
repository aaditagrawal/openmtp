import { spawn } from 'child_process';
import { checkIf } from './checkIf';
import { log } from './log';

const PGREP_TIMEOUT_MS = 1500;

/**
 * Fast process lookup via macOS `pgrep`.
 * Prefer exact-ish path fragments (e.g. `Preview.app`) over short names.
 */
export const isProcessRunning = (query) => {
  checkIf(query, 'string');

  return new Promise((resolve) => {
    let settled = false;
    let timer = null;

    const finish = (value) => {
      if (settled) {
        return;
      }

      settled = true;

      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }

      resolve(value);
    };

    try {
      const child = spawn('pgrep', ['-if', query], {
        stdio: ['ignore', 'ignore', 'ignore'],
      });

      child.on('error', (e) => {
        log.error(e, 'isProcessRunning -> spawn');
        finish(false);
      });

      child.on('close', (code) => {
        finish(code === 0);
      });

      // Avoid hanging forever if pgrep is stuck.
      timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch (_) {
          // ignore
        }

        finish(false);
      }, PGREP_TIMEOUT_MS);

      // Don't keep the event loop alive solely for this watchdog.
      if (typeof timer.unref === 'function') {
        timer.unref();
      }
    } catch (e) {
      log.error(e, 'isProcessRunning -> err');
      finish(false);
    }
  });
};

export const isAnyProcessRunning = async (queries = []) => {
  checkIf(queries, 'array');

  if (queries.length === 0) {
    return false;
  }

  // Parallel lookups: common case is "none running"; wall time ≈ one pgrep.
  const results = await Promise.all(
    queries.map((query) => isProcessRunning(query)),
  );

  return results.some(Boolean);
};
