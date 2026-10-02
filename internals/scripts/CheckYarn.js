const { engines } = require('../../package.json');
const version = process.versions.node;
const [major, minor, patch] = version.split('.').map(Number);
const supported =
  (major === 22 && (minor > 22 || (minor === 22 && patch >= 1))) ||
  (major === 24 && minor >= 11) ||
  major > 24;
if (!supported) {
  console.error(
    `Node.js ${engines.node} is required; detected ${version}. Use the version in .node-version.`,
  );
  process.exit(1);
}
const userAgent = process.env.npm_config_user_agent || '';
if (userAgent && !userAgent.startsWith('bun/')) {
  console.error(
    'This project uses bun.lock. Install dependencies with bun install.',
  );
  process.exit(1);
}
console.info(`Using compatible Node.js version: ${version}`);
