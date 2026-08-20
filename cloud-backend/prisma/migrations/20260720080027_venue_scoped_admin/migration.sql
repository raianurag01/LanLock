-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "venue_id" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "venue_id" TEXT;

-- CreateIndex
CREATE INDEX "orders_venue_id_createdAt_idx" ON "orders"("venue_id", "createdAt" DESC);
