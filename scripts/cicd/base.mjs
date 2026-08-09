import 'zx/globals';
import { existsSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

process.env.FORCE_COLOR = 3;
$.shell = '/bin/zsh';

await $`export LANG=en_US.UTF-8`;
await $`export LC_ALL=en_US.UTF-8`;
