import { spawn } from 'node:child_process';
import { assertSafeLocalTestDatabase } from './testDatabaseGuard.js';
assertSafeLocalTestDatabase();
const isWindows = process.platform === 'win32';
const command = isWindows ? (process.env.ComSpec ?? 'cmd.exe') : 'npx';
const args = isWindows ? ['/d', '/s', '/c', 'npx tsx prisma/seed.ts'] : ['tsx', 'prisma/seed.ts'];
const seed = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
});
seed.on('error', (error) => {
    throw error;
});
seed.on('exit', (code) => {
    process.exitCode = code ?? 1;
});
