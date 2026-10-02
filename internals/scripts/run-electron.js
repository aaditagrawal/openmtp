const { spawn } = require('node:child_process');
const path = require('node:path');

// Agent hosts and Node launchers may export these; neither belongs in the GUI app.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
const child = spawn(require('electron'), process.argv.slice(2), {
  cwd: path.resolve(__dirname, '..', '..'),
  env,
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => child.kill(signal));
child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
