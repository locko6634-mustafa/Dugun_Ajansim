import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { hashPassword } from '../utils/crypto.js';
import { normalizeUsername } from '../utils/domain.js';

const username = normalizeUsername(process.env.ADMIN_BOOTSTRAP_USERNAME ?? '');
const password = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? '';

if (username.length < 3 || password.length < 12) {
  throw new Error(
    'ADMIN_BOOTSTRAP_USERNAME ve en az 12 karakterlik ADMIN_BOOTSTRAP_PASSWORD zorunludur.'
  );
}

const existingAdmin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
if (existingAdmin) {
  throw new Error('Sistemde zaten bir admin hesabı var. Bootstrap işlemi durduruldu.');
}

const passwordHash = await hashPassword(password);
const admin = await prisma.$transaction(async (transaction) => {
  const created = await transaction.user.create({
    data: {
      username,
      passwordHash,
      role: 'ADMIN',
      mustChangePassword: true,
      activeAt: new Date(),
    },
  });
  await transaction.auditLog.create({
    data: {
      actorUserId: created.id,
      action: 'admin.bootstrapped',
      targetType: 'User',
      targetId: created.id,
      correlationId: randomUUID(),
    },
  });
  return created;
});

console.log(`İlk admin oluşturuldu: ${admin.username}`);
await prisma.$disconnect();
