-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "user_id" TEXT;

-- CreateIndex
CREATE INDEX "orders_user_id_createdAt_idx" ON "orders"("user_id", "createdAt" DESC);
