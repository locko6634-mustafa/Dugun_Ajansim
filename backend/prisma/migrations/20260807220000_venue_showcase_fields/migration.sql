ALTER TABLE "venues"
ADD COLUMN "displayName" TEXT,
ADD COLUMN "imagePath" TEXT,
ADD COLUMN "displayOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "isFeatured" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "venues"
ADD CONSTRAINT "venues_displayOrder_nonnegative_check"
CHECK ("displayOrder" >= 0);

UPDATE "venues"
SET
  "displayName" = CASE "slug"
    WHEN 'rena-garden' THEN 'Rena'
    WHEN 'mafsel-omerli' THEN 'Ömerli Mafsel'
    WHEN 'green-house-garden' THEN 'Green House'
    WHEN 'cess-wedding' THEN 'Cess'
    WHEN 'yesil-nesil-garden' THEN 'Yeşil Nesil'
    WHEN 'bella-garden' THEN 'Bella'
    WHEN 'talia-garden' THEN 'Talia'
    ELSE "displayName"
  END,
  "imagePath" = CASE "slug"
    WHEN 'rena-garden' THEN 'assets/images/venues/rena.webp'
    WHEN 'mafsel-omerli' THEN 'assets/images/venues/omerli-mafsel.webp'
    WHEN 'green-house-garden' THEN 'assets/images/venues/green-house.webp'
    WHEN 'cess-wedding' THEN 'assets/images/venues/cess.webp'
    WHEN 'yesil-nesil-garden' THEN 'assets/images/venues/yesil-nesil.webp'
    WHEN 'bella-garden' THEN 'assets/images/venues/bella.webp'
    WHEN 'talia-garden' THEN 'assets/images/venues/talia.webp'
    ELSE "imagePath"
  END,
  "displayOrder" = CASE "slug"
    WHEN 'rena-garden' THEN 0
    WHEN 'mafsel-omerli' THEN 1
    WHEN 'green-house-garden' THEN 2
    WHEN 'cess-wedding' THEN 3
    WHEN 'yesil-nesil-garden' THEN 4
    WHEN 'bella-garden' THEN 5
    WHEN 'talia-garden' THEN 6
    ELSE "displayOrder"
  END,
  "isFeatured" = "slug" IN (
    'rena-garden',
    'mafsel-omerli',
    'green-house-garden',
    'cess-wedding',
    'yesil-nesil-garden',
    'bella-garden',
    'talia-garden'
  );

CREATE INDEX "venues_isActive_isPartner_isFeatured_displayOrder_idx"
ON "venues"("isActive", "isPartner", "isFeatured", "displayOrder");
