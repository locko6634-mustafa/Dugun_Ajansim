import { spawn } from 'node:child_process';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL entegrasyon testi için zorunludur.');
}

const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\/+/, ''));
if (process.env.NODE_ENV !== 'test' || !databaseName.endsWith('_test')) {
  throw new Error('Migration yalnızca NODE_ENV=test ve *_test veritabanında çalıştırılabilir.');
}

const isWindows = process.platform === 'win32';
const command = isWindows ? (process.env.ComSpec ?? 'cmd.exe') : 'npx';
const args = isWindows
  ? ['/d', '/s', '/c', 'npx prisma migrate deploy']
  : ['prisma', 'migrate', 'deploy'];
const migration = spawn(command, args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});

migration.on('error', (error) => {
  throw error;
});

migration.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
