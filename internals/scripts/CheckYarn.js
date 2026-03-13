const { semverSatisfies } = require('./semver');

const requiredNodeRange = '>=22 <26';
const supportedPackageManagers = ['bun', 'yarn', 'npm', 'pnpm'];

try {
  const nodeVersion = process.versions.node;

  if (!semverSatisfies(nodeVersion, requiredNodeRange)) {
    console.error(
      `Error: This project requires Node.js ${requiredNodeRange}. You have version ${nodeVersion}.\nPlease switch to a supported LTS release before installing dependencies.`
    );
    process.exit(1);
  }

  console.info(`Using compatible Node.js version: ${nodeVersion}`);
} catch (error) {
  console.error('Error checking Node.js version:', error);

  process.exit(1);
}

const npmExecPath = (process.env.npm_execpath || '').toLowerCase();
const userAgent = (process.env.npm_config_user_agent || '').toLowerCase();
const packageManager =
  supportedPackageManagers.find(
    (candidate) =>
      npmExecPath.includes(candidate) || userAgent.startsWith(`${candidate}/`)
  ) || 'unknown';

if (!supportedPackageManagers.includes(packageManager)) {
  console.warn(
    '\u001b[33mThis repository expects Bun, Yarn, npm, or pnpm to run package scripts. Bun or Yarn are recommended for local development.\u001b[39m'
  );
}
