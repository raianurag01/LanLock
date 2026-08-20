import { Injectable, Logger } from '@nestjs/common';
import { SessionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { COINS_PER_HOUR, RATE_PER_HOUR } from './wallet.constants';

export interface CloseSessionResult {
    sessionSeconds: number;
    amountCharged: number;
    newBalance: number;
}

export interface WalletSummary {
    balance: number;
    activeSession: { pcId: string; startTime: string } | null;
    lanCoins: number;
    /** True when the caller's active device session is at a coinRewards venue. */
    coinsEnabled: boolean;
    totalPlayedSeconds: number;
}

@Injectable()
export class WalletService {
    private readonly logger = new Logger(WalletService.name);

    constructor(private readonly prisma: PrismaService) {}

    /**
     * Opens a billing session for a QR-paired device. Idempotent for the same
     * user+pcId (a re-scan of an already-paired PC doesn't reset the clock).
     * Any other stale ACTIVE session left on this pcId (e.g. a previous
     * owner's session that never got closed) is cancelled first so the
     * device never has two open sessions.
     */
    async openDeviceSession(
        userId: string,
        pcId: string,
        venueId?: string | null,
    ): Promise<void> {
        const existing = await this.prisma.session.findFirst({
            where: { userId, pcId, status: SessionStatus.ACTIVE },
        });
        if (existing) return;

        await this.prisma.session.updateMany({
            where: { pcId, status: SessionStatus.ACTIVE },
            data: { status: SessionStatus.CANCELLED, endTime: new Date() },
        });

        await this.prisma.session.create({
            data: { userId, pcId, venueId: venueId ?? null, status: SessionStatus.ACTIVE },
        });
    }

    /**
     * Closes the newest ACTIVE session for this user+pcId and debits the
     * elapsed time from walletBalance. Best-effort: if no ACTIVE session is
     * found (e.g. the pairing predates this feature) it returns null and the
     * caller's lock flow proceeds unaffected — billing must never block a
     * lock, same principle as EventLogService's fire-and-forget writes.
     */
    async closeDeviceSession(
        userId: string,
        pcId: string,
    ): Promise<CloseSessionResult | null> {
        try {
            const session = await this.prisma.session.findFirst({
                where: { userId, pcId, status: SessionStatus.ACTIVE },
                orderBy: { startTime: 'desc' },
            });
            if (!session) return null;

            const endTime = new Date();
            const sessionSeconds = Math.max(
                0,
                Math.floor((endTime.getTime() - session.startTime.getTime()) / 1000),
            );
            // Whole-₹, rounded up so a sub-minute session still charges ₹1
            // rather than nothing.
            const amountCharged = Math.ceil((sessionSeconds / 3600) * RATE_PER_HOUR);

            const [, user] = await this.prisma.$transaction([
                this.prisma.session.update({
                    where: { id: session.id },
                    data: { status: SessionStatus.COMPLETED, endTime, amountCharged },
                }),
                this.prisma.user.update({
                    where: { id: userId },
                    data: { walletBalance: { decrement: amountCharged } },
                    select: { walletBalance: true },
                }),
            ]);

            return { sessionSeconds, amountCharged, newBalance: user.walletBalance };
        } catch (err) {
            this.logger.error(
                `closeDeviceSession failed for userId=${userId} pcId=${pcId}: ${(err as Error).message}`,
            );
            return null;
        }
    }

    async topup(userId: string, amount: number): Promise<{ balance: number }> {
        const user = await this.prisma.user.update({
            where: { id: userId },
            data: { walletBalance: { increment: amount } },
            select: { walletBalance: true },
        });
        return { balance: user.walletBalance };
    }

    async getSummary(userId: string): Promise<WalletSummary> {
        const [user, active, completed] = await Promise.all([
            this.prisma.user.findUniqueOrThrow({
                where: { id: userId },
                select: { walletBalance: true },
            }),
            this.prisma.session.findFirst({
                where: { userId, pcId: { not: null }, status: SessionStatus.ACTIVE },
                orderBy: { startTime: 'desc' },
            }),
            this.prisma.session.findMany({
                where: {
                    userId,
                    status: SessionStatus.COMPLETED,
                    venueId: { not: null },
                },
                select: { startTime: true, endTime: true, venueId: true },
            }),
        ]);

        // LanCoins is LURK's program: only completed sessions at a
        // coinRewards venue count toward the total.
        const venueIds = [...new Set(completed.map((s) => s.venueId!))];
        const coinVenues = venueIds.length
            ? await this.prisma.venue.findMany({
                  where: { id: { in: venueIds }, coinRewards: true },
                  select: { id: true },
              })
            : [];
        const coinVenueIds = new Set(coinVenues.map((v) => v.id));

        let totalPlayedSeconds = 0;
        let coinsSeconds = 0;
        for (const s of completed) {
            if (!s.endTime) continue;
            const seconds = Math.max(
                0,
                Math.floor((s.endTime.getTime() - s.startTime.getTime()) / 1000),
            );
            totalPlayedSeconds += seconds;
            if (coinVenueIds.has(s.venueId!)) coinsSeconds += seconds;
        }
        const lanCoins = Math.floor((coinsSeconds / 3600) * COINS_PER_HOUR);

        let coinsEnabled = false;
        if (active?.venueId) {
            const venue = await this.prisma.venue.findUnique({
                where: { id: active.venueId },
                select: { coinRewards: true },
            });
            coinsEnabled = venue?.coinRewards ?? false;
        }

        return {
            balance: user.walletBalance,
            activeSession: active?.pcId
                ? { pcId: active.pcId, startTime: active.startTime.toISOString() }
                : null,
            lanCoins,
            coinsEnabled,
            totalPlayedSeconds,
        };
    }
}
