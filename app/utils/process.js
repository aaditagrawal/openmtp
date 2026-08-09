import { spawn } from 'child_process';
import { checkIf } from './checkIf';
import { log } from './log';

/**
 * Fast process lookup via macOS `pgrep`.
 * Prefer exact-ish path fragments (e.g. `Preview.app`) over short names.
 */
export const isProcessRunning = (query) => {
  checkIf(query, 'string');

  return new Promise((resolve) => {
    let settled = false;

    const finish = (value) => {
      if (settled) {
        return;
      }

      settled = true;
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
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch (_) {
          // ignore
        }

        finish(false);
      }, 1500);
    } catch (e) {
      log.error(e, 'isProcessRunning -> err');
      finish(false);
    }
  });
};

export const isAnyProcessRunning = async (queries = []) => {
  checkIf(queries, 'array');

  // eslint-disable-next-line no-restricted-syntax
  for (const query of queries) {
    // eslint-disable-next-line no-await-in-loop
    if (await isProcessRunning(query)) {
      return true;
    }
  }

  return false;
};
