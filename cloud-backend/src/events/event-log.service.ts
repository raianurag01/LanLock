import { Injectable, Logger } from '@nestjs/common';
import { DeviceEventType, EventLog } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Append-only writer/reader for the event_logs audit trail.
 *
 * Writes are fire-and-forget by design: every caller sits on the lock or
 * connection hot path, so a logging failure is swallowed (and logged) — it
 * must never break the flow it is auditing.
 */
@Injectable()
export class EventLogService {
    private readonly logger = new Logger(EventLogService.name);

    constructor(private readonly prisma: PrismaService) {}

    async record(
        pcId: string,
        type: DeviceEventType,
        detail?: string,
    ): Promise<void> {
        try {
            await this.prisma.eventLog.create({ data: { pcId, type, detail } });
        } catch (err) {
            this.logger.error(
                `Failed to record ${type} for pcId=${pcId}: ${(err as Error).message}`,
            );
        }
    }

    /** Newest-first slice of the audit trail (admin Activity Feed). */
    async recent(limit = 20): Promise<EventLog[]> {
        return this.prisma.eventLog.findMany({
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
    }

    /**
     * Most recent LOCKED event initiated by this user. LOCKED events store the
     * initiator's userId in `detail` because the UserDevice pairing row is
     * deleted on lock — this is the only surviving link back to the user.
     */
    async lastLockedByUser(userId: string): Promise<EventLog | null> {
        return this.prisma.eventLog.findFirst({
            where: { type: DeviceEventType.LOCKED, detail: userId },
            orderBy: { createdAt: 'desc' },
        });
    }
}
