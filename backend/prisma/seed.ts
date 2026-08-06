import { PrismaClient } from '@prisma/client';

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
        update: {},
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
      update: {},
    }),
    ...services.map(([code, category, name, priceCents, imagePath]) =>
      prisma.service.upsert({
        where: { code },
        create: { code, category, name, priceCents, imagePath },
        update: {},
      }),
    ),
  ]);
};

main()
  .then(() => console.log('Salon, paket ve hizmet başlangıç verileri hazırlandı.'))
  .finally(() => prisma.$disconnect());
