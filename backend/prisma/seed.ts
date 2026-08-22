import { Prisma, PrismaClient } from "@prisma/client";

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
    slug: "cess-wedding-park",
    name: "Cess Wedding Park",
    displayName: "Cess Wedding Park",
    imagePath: "assets/images/venues/cess.webp",
    displayOrder: 3
  },
  {
    slug: "cess-wedding-orman",
    name: "Cess Wedding Orman",
    displayName: "Cess Wedding Orman",
    imagePath: "assets/images/venues/cess.webp",
    displayOrder: 4
  },
  {
    slug: "yesil-nesil-garden-hayal-bahce",
    name: "Yeşil Nesil Garden Hayal Bahçe",
    displayName: "Yeşil Nesil Garden Hayal Bahçe",
    imagePath: "assets/images/venues/yesil-nesil.webp",
    displayOrder: 5
  },
  {
    slug: "yesil-nesil-garden-masal-bahce",
    name: "Yeşil Nesil Garden Masal Bahçe",
    displayName: "Yeşil Nesil Garden Masal Bahçe",
    imagePath: "assets/images/venues/yesil-nesil.webp",
    displayOrder: 6
  },
  {
    slug: "yesil-nesil-garden-kale-bahce",
    name: "Yeşil Nesil Garden Kale Bahçe",
    displayName: "Yeşil Nesil Garden Kale Bahçe",
    imagePath: "assets/images/venues/yesil-nesil.webp",
    displayOrder: 7
  },
  {
    slug: "yesil-nesil-garden-ruya-bahce",
    name: "Yeşil Nesil Garden Rüya Bahçe",
    displayName: "Yeşil Nesil Garden Rüya Bahçe",
    imagePath: "assets/images/venues/yesil-nesil.webp",
    displayOrder: 8
  },
  {
    slug: "bella-garden",
    name: "Bella Garden",
    displayName: "Bella",
    imagePath: "assets/images/venues/bella.webp",
    displayOrder: 9
  },
  {
    slug: "talia-garden",
    name: "Talia Garden",
    displayName: "Talia",
    imagePath: "assets/images/venues/talia.webp",
    displayOrder: 10
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

const packages: Prisma.PackageCreateInput[] = [
  {
    code: "mini",
    name: "Mini Paket",
    subtitle: "Hazır çekim paketi",
    description: "Düğün gününüz için temel çekim kapsamı.",
    imagePath: "assets/images/why-digital-delivery.webp",
    priceCents: 2_000_000,
    features: ["Aktüel Kamera (Full Çekim 1080p)", "10 Poz Dijital Aile Pozu (Düğün Sonunda)"]
  },
  {
    code: "classic",
    name: "Classic Paket",
    subtitle: "Kapsamlı çekim paketi",
    description: "Düğün gününün temel çekimlerini geniş prodüksiyon kapsamıyla birleştirir.",
    imagePath: "assets/images/hero-couple.webp",
    priceCents: 4_500_000,
    deliveryText: "Takı ve 3. şahıs fotoğrafları verilmez.",
    features: [
      "Aktüel Kamera (Full Çekim 1080p)",
      "10 Poz Dijital Aile Pozu (Düğün Sonunda)",
      "Drone Çekimi (Düğün Anında)",
      "Düğün Hikayesi (Düğün Anında)",
      "Gelin Damat Ön Çekim",
      "Gelin Damat Fotoğraf Arşivi"
    ]
  }
];

const main = async () => {
  await prisma.$transaction([
    prisma.$queryRaw(Prisma.sql`
      SELECT
        set_config('app.actor_role', 'maintenance', true),
        set_config('app.purpose', 'maintenance.seed', true)
    `),
    ...venues.map((venue) =>
      prisma.venue.upsert({
        where: { slug: venue.slug },
        create: { ...venue, isFeatured: true },
        update: {}
      })
    ),
    ...packages.map((packageItem) =>
      prisma.package.upsert({
        where: { code: packageItem.code },
        create: packageItem,
        update: {}
      })
    ),
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
