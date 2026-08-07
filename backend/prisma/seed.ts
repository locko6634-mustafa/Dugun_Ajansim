import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const venues = [
  {
    slug: "rena-garden",
    name: "Rena Garden",
    displayName: "Rena",
    imagePath: "assets/images/venues/rena.webp",
    displayOrder: 0
  },
  {
    slug: "mafsel-omerli",
    name: "Mafsel Ömerli",
    displayName: "Ömerli Mafsel",
    imagePath: "assets/images/venues/omerli-mafsel.webp",
    displayOrder: 1
  },
  {
    slug: "green-house-garden",
    name: "Green House Garden",
    displayName: "Green House",
    imagePath: "assets/images/venues/green-house.webp",
    displayOrder: 2
  },
  {
    slug: "cess-wedding",
    name: "Cess Wedding",
    displayName: "Cess",
    imagePath: "assets/images/venues/cess.webp",
    displayOrder: 3
  },
  {
    slug: "yesil-nesil-garden",
    name: "Yeşil Nesil Garden",
    displayName: "Yeşil Nesil",
    imagePath: "assets/images/venues/yesil-nesil.webp",
    displayOrder: 4
  },
  {
    slug: "bella-garden",
    name: "Bella Garden",
    displayName: "Bella",
    imagePath: "assets/images/venues/bella.webp",
    displayOrder: 5
  },
  {
    slug: "talia-garden",
    name: "Talia Garden",
    displayName: "Talia",
    imagePath: "assets/images/venues/talia.webp",
    displayOrder: 6
  }
] as const;

const services = [
  [
    "fotograf",
    "photo",
    "Düğün Fotoğrafçılığı",
    700_000,
    "assets/images/services/fotograf-cekimi.webp"
  ],
  [
    "video",
    "production",
    "Sinematik Düğün Filmi",
    900_000,
    "assets/images/services/video-cekimi.webp"
  ],
  ["drone", "production", "Drone Çekimi", 800_000, "assets/images/services/drone-cekimi.webp"],
  [
    "jimmy-jib",
    "production",
    "Jimmy Jib Çekimi",
    1_200_000,
    "assets/images/services/klip-cekimi.webp"
  ],
  ["dis-cekim", "photo", "Dış Çekim", 700_000, "assets/images/hero-couple.webp"],
  [
    "organizasyon",
    "experience",
    "Organizasyon Hizmetleri",
    550_000,
    "assets/images/services/360-video.webp"
  ],
  [
    "album",
    "experience",
    "Premium Albüm Tasarımı",
    700_000,
    "assets/images/services/album-tasarimi.webp"
  ],
  [
    "aninda-baski",
    "experience",
    "Anında Fotoğraf Baskısı",
    500_000,
    "assets/images/bride-portrait.webp"
  ]
] as const;

const main = async () => {
  await prisma.$transaction([
    ...venues.map((venue) =>
      prisma.venue.upsert({
        where: { slug: venue.slug },
        create: { ...venue, isFeatured: true },
        update: {}
      })
    ),
    prisma.package.upsert({
      where: { code: "mini" },
      create: {
        code: "mini",
        name: "Mini Paket",
        priceCents: 2_000_000,
        imagePath: "assets/images/hero-couple.webp"
      },
      update: {}
    }),
    ...services.map(([code, category, name, priceCents, imagePath]) =>
      prisma.service.upsert({
        where: { code },
        create: { code, category, name, priceCents, imagePath },
        update: {}
      })
    )
  ]);
};

main()
  .then(() => console.log("Salon, paket ve hizmet başlangıç verileri hazırlandı."))
  .finally(() => prisma.$disconnect());
