const { spawnSync } = require('child_process');
const path = require('path');

const cwd = path.resolve(__dirname, '..', '..');
const env = { ...process.env };
const npmExecPath = (env.npm_execpath || '').toLowerCase();
const userAgent = (env.npm_config_user_agent || '').toLowerCase();
const isBun = npmExecPath.includes('bun') || userAgent.startsWith('bun/');

if (isBun) {
  delete env.npm_execpath;
  delete env.NPM_CLI_JS;
  delete env.npm_config_user_agent;
}

const builderCli = require.resolve('electron-builder/out/cli/cli.js');
const result = spawnSync(process.execPath, [builderCli, 'install-app-deps'], {
  cwd,
  env,
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
