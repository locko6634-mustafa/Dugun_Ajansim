import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadFileBackedSecrets } from '../config/fileSecrets.js';

loadFileBackedSecrets();

const prismaCli = fileURLToPath(new URL('../../node_modules/.bin/prisma', import.meta.url));
const child = spawn(prismaCli, ['migrate', 'deploy'], {
  env: process.env,
  stdio: 'inherit',
});

child.once('error', () => {
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
