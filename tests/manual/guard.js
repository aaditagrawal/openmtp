if (process.env.CI) {
  throw new Error('OpenMTP manual tests must not run in CI');
}
