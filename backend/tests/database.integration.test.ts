import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL entegrasyon testi için zorunludur.');
}

const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\/+/, ''));

if (process.env.NODE_ENV !== 'test' || !databaseName.endsWith('_test')) {
  throw new Error('Entegrasyon testi yalnızca NODE_ENV=test ve *_test veritabanında çalıştırılabilir.');
}

after(async () => {
  await prisma.$disconnect();
});

test('migration ile oluşturulan tablo ve gerçek healthcheck birlikte çalışır', async (context) => {
  const healthRecord = await prisma.systemHealth.create({
    data: { status: 'integration-test' },
  });

  context.after(async () => {
    await prisma.systemHealth.delete({ where: { id: healthRecord.id } });
  });

  const storedRecord = await prisma.systemHealth.findUnique({
    where: { id: healthRecord.id },
  });
  assert.equal(storedRecord?.status, 'integration-test');

  const response = await request(createApp()).get('/api/v1/health');

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.database, 'connected');
  assert.equal(response.headers['cache-control'], 'no-store');
});
