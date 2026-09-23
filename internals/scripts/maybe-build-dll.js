/**
 * postinstall helper: skip the renderer DLL when SKIP_DLL=1 (CI lint/prod builds).
 */
const { spawnSync } = require('child_process');
const { join } = require('path');

if (process.env.SKIP_DLL === '1') {
  process.exit(0);
}

const result = spawnSync(
  process.execPath,
  [join(__dirname, 'run-package-script.js'), 'build-dll'],
  { stdio: 'inherit' },
);

process.exit(result.status ?? 1);
