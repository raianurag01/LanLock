import { forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Order, OrderStatus, SessionStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DeviceGateway } from '../events/events.gateway';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';

@Injectable()
export class OrdersService {
    constructor(
        private readonly prisma: PrismaService,
        // Lazy/circular: EventsModule already imports OrdersModule (the
        // gateway ingests socket orders); this is the reverse edge so orders
        // can push live status updates back to the owner's mobile app.
        // forwardRef required on both providers that cross this cycle — see
        // the matching @Inject on DeviceGateway's `orders` param.
        @Inject(forwardRef(() => DeviceGateway))
        private readonly gateway: DeviceGateway,
    ) {}

    async create(input: {
        pcId: string;
        item: string;
        qty: number;
        amount: number;
        userId?: string | null;
        venueId?: string | null;
    }): Promise<Order> {
        // venueId is stamped explicitly by the socket path (client.data.venueId
        // from the desktop agent's handshake); the REST path resolves it from
        // the caller's active device session so admin Kitchen scoping works
        // for mobile orders too.
        const venueId =
            input.venueId ??
            (input.userId
                ? await this.resolveSessionVenue(input.userId, input.pcId)
                : null);

        const order = await this.prisma.order.create({
            data: {
                pcId: input.pcId,
                item: input.item,
                qty: input.qty,
                amount: input.amount,
                userId: input.userId ?? null,
                venueId,
            },
        });
        this.notifyOwner(order);
        return order;
    }

    /**
     * Newest-first order feed for the admin Kitchen Display. An ADMIN scoped
     * to a venue only sees that café's orders — never another venue's.
     */
    async recent(limit = 25, user?: AuthenticatedUser): Promise<Order[]> {
        const scopedVenueId = this.scopedVenueId(user);
        return this.prisma.order.findMany({
            where: {
                status: { not: OrderStatus.CANCELLED },
                ...(scopedVenueId ? { venueId: scopedVenueId } : {}),
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
    }

    /** Newest-first order history for the caller's mobile Orders tab. */
    async findMine(userId: string, limit = 25): Promise<Order[]> {
        return this.prisma.order.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
    }

    async updateStatus(
        id: string,
        status: OrderStatus,
        user?: AuthenticatedUser,
    ): Promise<Order> {
        const order = await this.prisma.order.findUnique({ where: { id } });
        if (!order) {
            throw new NotFoundException(`Order ${id} not found`);
        }
        const scopedVenueId = this.scopedVenueId(user);
        if (scopedVenueId && order.venueId !== scopedVenueId) {
            // 404, not 403 — a scoped admin shouldn't learn that an order
            // exists at another venue at all.
            throw new NotFoundException(`Order ${id} not found`);
        }
        const updated = await this.prisma.order.update({
            where: { id },
            data: { status },
        });
        this.notifyOwner(updated);
        return updated;
    }

    /** The venue an ADMIN is restricted to, or null (GAMER / unscoped admin). */
    private scopedVenueId(user?: AuthenticatedUser): string | null {
        return user?.role === UserRole.ADMIN && user.venueId ? user.venueId : null;
    }

    /** Café attribution for a mobile order: the caller's ACTIVE device
     * session for this pcId, if any. Best-effort — an order with no
     * resolvable venue is simply unscoped (visible to every admin), the same
     * fallback legacy/pre-migration orders already get. */
    private async resolveSessionVenue(
        userId: string,
        pcId: string,
    ): Promise<string | null> {
        const session = await this.prisma.session.findFirst({
            where: { userId, pcId, status: SessionStatus.ACTIVE },
            select: { venueId: true },
        });
        return session?.venueId ?? null;
    }

    /** Live status push to the ordering user's mobile app, if attributed. */
    private notifyOwner(order: Order): void {
        if (!order.userId) return;
        this.gateway.emitToUser(order.userId, 'order-updated', {
            id: order.id,
            item: order.item,
            qty: order.qty,
            amount: order.amount,
            status: order.status,
        });
    }
}
