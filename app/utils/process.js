import { execFile } from 'child_process';
import { checkIf } from './checkIf';
import { log } from './log';

let pendingSnapshot = null;
let cachedSnapshot = null;
let cachedAt = 0;

// Inspect executable names, never command arguments. Parallel pgrep -f calls
// used to match each other's search strings and invent USB conflicts.
export const matchesProcessName = (executable, query) =>
  executable.toLowerCase().includes(query.toLowerCase());

const getProcessNames = () => {
  if (cachedSnapshot && Date.now() - cachedAt < 1000) {
    return Promise.resolve(cachedSnapshot);
  }
  if (pendingSnapshot) return pendingSnapshot;
  pendingSnapshot = new Promise((resolve) => {
    execFile(
      '/bin/ps',
      ['-axo', 'comm='],
      { timeout: 1500, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          log.error(error, 'getProcessNames');
          resolve([]);
          return;
        }
        cachedSnapshot = stdout
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
        cachedAt = Date.now();
        resolve(cachedSnapshot);
      },
    );
  }).finally(() => {
    pendingSnapshot = null;
  });
  return pendingSnapshot;
};

export const isProcessRunning = async (query) => {
  checkIf(query, 'string');
  return (await getProcessNames()).some((name) =>
    matchesProcessName(name, query),
  );
};

export const isAnyProcessRunning = async (queries = []) => {
  checkIf(queries, 'array');
  if (queries.length === 0) return false;
  const names = await getProcessNames();
  return queries.some((query) =>
    names.some((name) => matchesProcessName(name, query)),
  );
};
