-- CreateEnum
CREATE TYPE "DeviceEventType" AS ENUM ('PAIRED', 'CONNECTED', 'DISCONNECTED', 'LOCKED', 'AUTH_REJECTED');

-- CreateTable
CREATE TABLE "event_logs" (
    "id" TEXT NOT NULL,
    "pc_id" TEXT NOT NULL,
    "type" "DeviceEventType" NOT NULL,
    "detail" TEXT,
    "ip_address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_logs_pc_id_createdAt_idx" ON "event_logs"("pc_id", "createdAt" DESC);
