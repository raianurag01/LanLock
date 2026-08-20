import {
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PCStatus, SessionStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';

export interface VenueSummary {
    id: string;
    name: string;
    location: string;
    pcTotal: number;
    pcAvailable: number;
    /** LanCoins loyalty is opt-in per venue — LURK has it, others don't. */
    coinRewards: boolean;
}

export interface ReservationResponse {
    pcName: string;
    venueId: string;
    reservedUntil: string;
}

export interface VenuePc {
    id: string;
    name: string;
    specs: string | null;
    status: PCStatus;
    /** ISO start time of the ACTIVE session on this PC, if any. */
    sessionStartedAt: string | null;
}

const RESERVATION_MINUTES = 30;

@Injectable()
export class VenuesService {
    constructor(private readonly prisma: PrismaService) {}

    /**
     * GAMERs (mobile Map tab) always see every café. An ADMIN scoped to a
     * venue sees only that one — enforced here, not trusted from the client,
     * so a LURK admin can never enumerate other cafés even by hand-crafting
     * a request.
     */
    async getVenues(user?: AuthenticatedUser): Promise<VenueSummary[]> {
        const scopedVenueId = this.scopedVenueId(user);
        const venues = await this.prisma.venue.findMany({
            where: scopedVenueId ? { id: scopedVenueId } : undefined,
            include: { pcNodes: { select: { status: true } } },
            orderBy: { name: 'asc' },
        });
        return venues.map((v) => ({
            id: v.id,
            name: v.name,
            location: v.location,
            pcTotal: v.pcNodes.length,
            pcAvailable: v.pcNodes.filter((p) => p.status === PCStatus.ONLINE)
                .length,
            coinRewards: v.coinRewards,
        }));
    }

    /** Per-station status list for one venue — the Command Center grid. */
    async getVenuePcs(
        venueId: string,
        user?: AuthenticatedUser,
    ): Promise<VenuePc[]> {
        this.assertVenueInScope(venueId, user);
        const venue = await this.prisma.venue.findUnique({
            where: { id: venueId },
            select: { id: true },
        });
        if (!venue) {
            throw new NotFoundException(`Venue ${venueId} not found`);
        }
        const pcs = await this.prisma.pCNode.findMany({
            where: { venueId },
            orderBy: { name: 'asc' },
            select: {
                id: true,
                name: true,
                specs: true,
                status: true,
                sessions: {
                    where: { status: SessionStatus.ACTIVE },
                    orderBy: { startTime: 'desc' },
                    take: 1,
                    select: { startTime: true },
                },
            },
        });
        return pcs.map((pc) => ({
            id: pc.id,
            name: pc.name,
            specs: pc.specs,
            status: pc.status,
            sessionStartedAt: pc.sessions[0]?.startTime.toISOString() ?? null,
        }));
    }

    /**
     * End the session on a station from the admin dashboard.
     *
     * Turnover state machine (dual-use endpoint):
     * - IN_USE → MAINTENANCE: sessions are closed and the station enters
     *   "turnover" (needs cleaning). MAINTENANCE keeps it out of the mobile
     *   app's reservable pool (which counts ONLINE only).
     * - MAINTENANCE → ONLINE: staff "Mark Clean" — the sessions updateMany is
     *   a no-op (nothing ACTIVE) and the station returns to the pool.
     * Roadmap: a dedicated CLEANING enum value via migration to separate real
     * maintenance from turnover.
     */
    async releasePc(
        pcNodeId: string,
        user?: AuthenticatedUser,
    ): Promise<{ pcName: string }> {
        const pc = await this.prisma.pCNode.findUnique({
            where: { id: pcNodeId },
            select: { id: true, name: true, status: true, venueId: true },
        });
        if (!pc) {
            throw new NotFoundException(`Station ${pcNodeId} not found`);
        }
        this.assertVenueInScope(pc.venueId, user);
        const nextStatus =
            pc.status === PCStatus.MAINTENANCE
                ? PCStatus.ONLINE
                : PCStatus.MAINTENANCE;
        await this.prisma.$transaction([
            this.prisma.session.updateMany({
                where: { pcNodeId, status: SessionStatus.ACTIVE },
                data: { status: SessionStatus.COMPLETED, endTime: new Date() },
            }),
            this.prisma.pCNode.update({
                where: { id: pcNodeId },
                data: { status: nextStatus },
            }),
        ]);
        return { pcName: pc.name };
    }

    /**
     * Claim the first available PC at the venue: flip it to IN_USE and open an
     * ACTIVE Session for the caller — a real reservation trail on the models
     * that already exist. (No expiry job yet; RESERVATION_MINUTES is the
     * contract communicated to the app.)
     */
    async reservePc(
        userId: string,
        venueId: string,
    ): Promise<ReservationResponse> {
        const venue = await this.prisma.venue.findUnique({
            where: { id: venueId },
            select: { id: true },
        });
        if (!venue) {
            throw new NotFoundException(`Venue ${venueId} not found`);
        }

        const pc = await this.prisma.pCNode.findFirst({
            where: { venueId, status: PCStatus.ONLINE },
            orderBy: { name: 'asc' },
        });
        if (!pc) {
            throw new ConflictException(
                'No PCs available at this venue right now',
            );
        }

        await this.prisma.$transaction([
            this.prisma.pCNode.update({
                where: { id: pc.id },
                data: { status: PCStatus.IN_USE },
            }),
            this.prisma.session.create({
                data: {
                    userId,
                    pcNodeId: pc.id,
                    // Venue attribution mirrors QR-paired device sessions —
                    // keeps LanCoins accounting (WalletService.getSummary)
                    // working the same way for both session types.
                    venueId,
                    status: SessionStatus.ACTIVE,
                },
            }),
        ]);

        return {
            pcName: pc.name,
            venueId,
            reservedUntil: new Date(
                Date.now() + RESERVATION_MINUTES * 60_000,
            ).toISOString(),
        };
    }

    // ── Scoping ────────────────────────────────────────────────────────────

    /** The venue an ADMIN is restricted to, or null (unscoped: GAMER or an
     * ADMIN with no home venue). */
    private scopedVenueId(user?: AuthenticatedUser): string | null {
        if (user?.role === UserRole.ADMIN && user.venueId) {
            return user.venueId;
        }
        return null;
    }

    /** Throws 404 (not 403 — avoids revealing that another venue exists) if
     * a scoped ADMIN requests a venue that isn't theirs. */
    private assertVenueInScope(
        venueId: string | null,
        user?: AuthenticatedUser,
    ): void {
        const scoped = this.scopedVenueId(user);
        if (scoped && venueId !== scoped) {
            throw new NotFoundException('Venue not found');
        }
    }
}
