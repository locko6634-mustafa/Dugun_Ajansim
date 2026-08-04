import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

const venues = [
  ['cess-wedding', 'Cess Wedding'],
  ['bella-garden', 'Bella Garden'],
  ['yesil-nesil-garden', 'Yeşil Nesil Garden'],
  ['talia-garden', 'Talia Garden'],
  ['rena-garden', 'Rena Garden'],
  ['mafsel-omerli', 'Mafsel Ömerli'],
  ['green-house-garden', 'Green House Garden'],
] as const;

const services = [
  [
    'fotograf',
    'photo',
    'Düğün Fotoğrafçılığı',
    700_000,
    'assets/images/services/fotograf-cekimi.webp',
  ],
  [
    'video',
    'production',
    'Sinematik Düğün Filmi',
    900_000,
    'assets/images/services/video-cekimi.webp',
  ],
  ['drone', 'production', 'Drone Çekimi', 800_000, 'assets/images/services/drone-cekimi.webp'],
  [
    'jimmy-jib',
    'production',
    'Jimmy Jib Çekimi',
    1_200_000,
    'assets/images/services/klip-cekimi.webp',
  ],
  ['dis-cekim', 'photo', 'Dış Çekim', 700_000, 'assets/images/hero-couple.webp'],
  [
    'organizasyon',
    'experience',
    'Organizasyon Hizmetleri',
    550_000,
    'assets/images/services/360-video.webp',
  ],
  [
    'album',
    'experience',
    'Premium Albüm Tasarımı',
    700_000,
    'assets/images/services/album-tasarimi.webp',
  ],
  [
    'aninda-baski',
    'experience',
    'Anında Fotoğraf Baskısı',
    500_000,
    'assets/images/bride-portrait.webp',
  ],
] as const;

const main = async () => {
  await prisma.$transaction([
    ...venues.map(([slug, name]) =>
      prisma.venue.upsert({
        where: { slug },
        create: { slug, name },
        update: { name, isActive: true },
      }),
    ),
    prisma.package.upsert({
      where: { code: 'mini' },
      create: {
        code: 'mini',
        name: 'Mini Paket',
        priceCents: 2_000_000,
        imagePath: 'assets/images/hero-couple.webp',
      },
      update: {
        name: 'Mini Paket',
        priceCents: 2_000_000,
        imagePath: 'assets/images/hero-couple.webp',
      },
    }),
    ...services.map(([code, category, name, priceCents, imagePath]) =>
      prisma.service.upsert({
        where: { code },
        create: { code, category, name, priceCents, imagePath },
        update: { category, name, priceCents, imagePath },
      }),
    ),
  ]);

  const seededVenues = await prisma.venue.findMany({
    where: { slug: { in: ['cess-wedding', 'bella-garden'] } },
    select: { id: true, slug: true },
  });
  const venueBySlug = new Map(seededVenues.map((venue) => [venue.slug, venue.id]));
  const passwordHash = await argon2.hash('SalonMVP!2026Giris', {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  for (const [username, venueSlug] of [
    ['cess-sorumlu', 'cess-wedding'],
    ['bella-sorumlu', 'bella-garden'],
  ] as const) {
    const venueId = venueBySlug.get(venueSlug);
    if (!venueId) continue;
    await prisma.user.upsert({
      where: { username },
      create: {
        username,
        passwordHash,
        role: 'SALON_YETKILISI',
        status: 'ACTIVE',
        mustChangePassword: false,
        passwordChangedAt: new Date(),
        venueId,
      },
      update: {
        passwordHash,
        role: 'SALON_YETKILISI',
        status: 'ACTIVE',
        mustChangePassword: false,
        temporaryPasswordExpiresAt: null,
        passwordChangedAt: new Date(),
        venueId,
      },
    });
  }

  for (const row of [
    ['Cem', 'Arslan', '+905551110101', ['PHOTOGRAPHY', 'DRONE'], 'cess-wedding'],
    ['Ece', 'Kaya', '+905551110102', ['VIDEO', 'EDITING'], 'cess-wedding'],
    ['Baran', 'Yıldız', '+905551110201', ['PHOTOGRAPHY', 'ASSISTANT'], 'bella-garden'],
    ['Derya', 'Akın', '+905551110202', ['VIDEO', 'ALBUM'], 'bella-garden'],
  ] as const) {
    const [firstName, lastName, phone, specialties, venueSlug] = row;
    const venueId = venueBySlug.get(venueSlug);
    if (!venueId) continue;
    const existing = await prisma.staff.findFirst({ where: { phone } });
    if (existing) {
      await prisma.staff.update({
        where: { id: existing.id },
        data: { firstName, lastName, specialties: [...specialties], venueId, isActive: true },
      });
    } else {
      await prisma.staff.create({
        data: { firstName, lastName, phone, specialties: [...specialties], venueId },
      });
    }
  }
};

main()
  .then(() => console.log('Salon, paket ve hizmet başlangıç verileri hazırlandı.'))
  .finally(() => prisma.$disconnect());
