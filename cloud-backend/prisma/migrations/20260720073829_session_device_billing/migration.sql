-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "amount_charged" INTEGER,
ADD COLUMN     "pc_id" TEXT,
ADD COLUMN     "venue_id" TEXT,
ALTER COLUMN "pc_node_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "venues" ADD COLUMN     "coin_rewards" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "sessions_user_id_status_idx" ON "sessions"("user_id", "status");

-- CreateIndex
CREATE INDEX "sessions_pc_id_status_idx" ON "sessions"("pc_id", "status");
