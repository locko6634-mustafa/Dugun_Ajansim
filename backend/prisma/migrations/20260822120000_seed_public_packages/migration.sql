INSERT INTO "packages" (
  "id", "code", "name", "subtitle", "description", "imagePath", "priceCents",
  "features", "isActive", "createdAt", "updatedAt"
)
VALUES (
  'a1a151c0-0000-4000-8000-000000000001',
  'mini',
  'Mini Paket',
  'Hazır çekim paketi',
  'Düğün gününüz için temel çekim kapsamı.',
  'assets/images/why-digital-delivery.webp',
  2000000,
  ARRAY[
    'Aktüel Kamera (Full Çekim 1080p)',
    '10 Poz Dijital Aile Pozu (Düğün Sonunda)'
  ]::TEXT[],
  TRUE,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO NOTHING;

UPDATE "packages"
SET
  "subtitle" = COALESCE("subtitle", 'Hazır çekim paketi'),
  "description" = COALESCE("description", 'Düğün gününüz için temel çekim kapsamı.'),
  "imagePath" = CASE
    WHEN "imagePath" IS NULL OR "imagePath" = 'assets/images/hero-couple.webp'
      THEN 'assets/images/why-digital-delivery.webp'
    ELSE "imagePath"
  END,
  "features" = CASE
    WHEN cardinality("features") = 0 THEN ARRAY[
      'Aktüel Kamera (Full Çekim 1080p)',
      '10 Poz Dijital Aile Pozu (Düğün Sonunda)'
    ]::TEXT[]
    ELSE "features"
  END,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'mini';

INSERT INTO "packages" (
  "id", "code", "name", "subtitle", "description", "imagePath", "priceCents",
  "deliveryText", "features", "isActive", "createdAt", "updatedAt"
)
VALUES (
  'c1a551c0-0000-4000-8000-000000000001',
  'classic',
  'Classic Paket',
  'Kapsamlı çekim paketi',
  'Düğün gününün temel çekimlerini geniş prodüksiyon kapsamıyla birleştirir.',
  'assets/images/hero-couple.webp',
  4500000,
  'Takı ve 3. şahıs fotoğrafları verilmez.',
  ARRAY[
    'Aktüel Kamera (Full Çekim 1080p)',
    '10 Poz Dijital Aile Pozu (Düğün Sonunda)',
    'Drone Çekimi (Düğün Anında)',
    'Düğün Hikayesi (Düğün Anında)',
    'Gelin Damat Ön Çekim',
    'Gelin Damat Fotoğraf Arşivi'
  ]::TEXT[],
  TRUE,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO NOTHING;
