#!/usr/bin/env node
// Upload symbols only when explicitly configured for this fork's Sentry project.
const { downloadArtifact } = require('@electron/get');
const SentryCli = require('@sentry/cli');
const { devDependencies } = require('./package.json');

async function main() {
  if (process.env.OPENMTP_TELEMETRY !== '1' || !process.env.SENTRY_AUTH_TOKEN) {
    throw new Error(
      'Set OPENMTP_TELEMETRY=1 and your SENTRY_AUTH_TOKEN to upload symbols.',
    );
  }
  const sentryCli = new SentryCli('./sentry.properties');
  for (const arch of ['arm64', 'x64']) {
    const zipPath = await downloadArtifact({
      version: devDependencies.electron,
      artifactName: 'electron',
      platform: 'darwin',
      arch,
      artifactSuffix: 'dsym',
      cacheRoot: '.electron-symbols',
    });
    await sentryCli.execute(['debug-files', 'upload', zipPath], true);
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
