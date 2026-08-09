const { spawnSync } = require('child_process');
const path = require('path');

const [, , scriptName, ...extraArgs] = process.argv;

if (!scriptName) {
  console.error(
    'Usage: node ./internals/scripts/run-package-script.js <script> [...args]',
  );
  process.exit(1);
}

const npmExecPath = (process.env.npm_execpath || '').toLowerCase();
const userAgent = (process.env.npm_config_user_agent || '').toLowerCase();
const cwd = path.resolve(__dirname, '..', '..');

const commandExists = (command) => {
  const probe = spawnSync(command, ['--version'], {
    cwd,
    shell: process.platform === 'win32',
    stdio: 'ignore',
  });

  return !probe.error && (probe.status === 0 || probe.status === null);
};

const detectPackageManager = () => {
  if (npmExecPath.includes('bun') || userAgent.startsWith('bun/')) {
    return {
      command: 'bun',
      args: ['run', scriptName],
    };
  }

  if (npmExecPath.includes('yarn') || userAgent.startsWith('yarn/')) {
    return {
      command: 'yarn',
      args: [scriptName],
    };
  }

  if (npmExecPath.includes('pnpm') || userAgent.startsWith('pnpm/')) {
    return {
      command: 'pnpm',
      args: ['run', scriptName],
    };
  }

  // Prefer Bun when available — packageManager is bun and scripts are faster under it.
  if (commandExists('bun')) {
    return {
      command: 'bun',
      args: ['run', scriptName],
    };
  }

  return {
    command: 'npm',
    args: ['run', scriptName, '--'],
  };
};

const { command, args } = detectPackageManager();
const result = spawnSync(command, [...args, ...extraArgs], {
  cwd,
  shell: process.platform === 'win32',
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
