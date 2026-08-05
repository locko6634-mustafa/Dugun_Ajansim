-- AlterTable
ALTER TABLE "packages" ADD COLUMN     "deliveryText" TEXT,
ADD COLUMN     "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "subtitle" TEXT;

-- AlterTable
ALTER TABLE "services" ADD COLUMN     "delivery" TEXT,
ADD COLUMN     "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "gallery" TEXT[] DEFAULT ARRAY[]::TEXT[];
