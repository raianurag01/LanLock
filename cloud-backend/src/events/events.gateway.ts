import {
    ConnectedSocket,
    MessageBody,
    OnGatewayConnection,
    OnGatewayDisconnect,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
} from '@nestjs/websockets';
import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DeviceEventType } from '@prisma/client';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { OrdersService } from '../orders/orders.service';
import { EventLogService } from './event-log.service';

interface GatewayHandshakeAuth {
    pcId?: string;
    token?: string;
    /** Café this desktop agent is installed at (App.tsx's VENUE_ID). */
    venueId?: string;
}

type DeviceEvent = 'lock-device' | 'unlock-device' | 'display-message';

export interface AgentStatus {
    gameActive: boolean;
    gameName: string | null;
    updatedAt: Date;
}

/**
 * Allowed WebSocket origins. The desktop agent's origins are ALWAYS allowed —
 * the electron-vite dev server in dev, and file:// (or the literal "null"
 * Origin Chromium sends for file-scheme pages) when packaged. Previously,
 * setting FRONTEND_URL *replaced* these dev fallbacks, silently locking the
 * desktop agent out of the handshake. FRONTEND_URL (comma-separated) now
 * only ADDS origins. Non-browser clients (no Origin header) are not affected
 * by CORS — the handshake auth below is what gates them.
 */
const DESKTOP_ORIGINS = [
    'http://localhost:3000',
    'http://localhost:5173',
    'file://',
    'null',
];
const ALLOWED_ORIGINS = [
    ...new Set([
        ...DESKTOP_ORIGINS,
        ...(process.env.FRONTEND_URL?.split(',').map((o) => o.trim()) ?? []),
    ]),
];

@Injectable()
@WebSocketGateway({
    cors: {
        origin: ALLOWED_ORIGINS,
        credentials: true,
    },
})
export class DeviceGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    private readonly server: Server;

    private readonly logger = new Logger(DeviceGateway.name);

    // Live telemetry pushed by desktop agents (game detection). In-memory by
    // design: it describes "right now" and dies with the connection.
    private readonly agentStatuses = new Map<string, AgentStatus>();

    constructor(
        private readonly jwtService: JwtService,
        private readonly prisma: PrismaService,
        private readonly eventLog: EventLogService,
        // forwardRef: OrdersService now injects DeviceGateway back (live
        // order status push) — see the matching @Inject in orders.service.ts.
        @Inject(forwardRef(() => OrdersService))
        private readonly orders: OrdersService,
    ) {}

    async handleConnection(client: Socket): Promise<void> {
        const origin = client.handshake.headers.origin ?? '(no origin header)';
        console.log(`[Handshake] socketId=${client.id} origin=${origin}`);

        // Primary channel is handshake auth (what the desktop agent sends);
        // query.pcId is accepted as a fallback for clients that pass it there.
        const auth = client.handshake.auth as GatewayHandshakeAuth;
        const pcId =
            auth.pcId ?? (client.handshake.query.pcId as string | undefined);
        const token = auth.token;
        const venueId = auth.venueId;

        // pcId is checked FIRST so the desktop-agent paths are untouched by
        // the user-channel addition below.
        if (!pcId && !token) {
            console.error(
                `[Handshake] ❌ FAILED origin=${origin} — no pcId or token in handshake auth`,
            );
            this.reject(client, 'missing pcId or token in handshake auth');
            return;
        }

        try {
            if (pcId && token) {
                // Full auth: JWT signature + pcId ownership verified against DB.
                console.log(`[Handshake] pcId received: ${pcId}`);
                await this.admitWithToken(client, pcId, token, venueId);
            } else if (pcId) {
                // Device-only auth: pcId serves as the credential (122-bit UUIDv4,
                // exchanged in-person via QR). Device must already be paired.
                console.log(`[Handshake] pcId received: ${pcId}`);
                await this.admitByPcId(client, pcId, venueId);
            } else {
                // User channel (mobile app): JWT only, no pcId. Joins the
                // caller's user room for live device/order updates.
                this.admitUser(client, token!);
            }
        } catch (err) {
            this.reject(client, (err as Error).message, pcId);
        }
    }

    handleDisconnect(client: Socket): void {
        const pcId = client.data.pcId as string | undefined;
        this.logger.log(
            `[DISCONNECT] socketId=${client.id}${pcId ? ` pcId=${pcId}` : ''}`,
        );
        if (pcId) {
            this.agentStatuses.delete(pcId);
            void this.eventLog.record(pcId, DeviceEventType.DISCONNECTED);
            const userId = client.data.userId as string | undefined;
            if (userId) {
                this.emitToUser(userId, 'device-disconnected', { pcId });
            }
        }
    }

    /**
     * Desktop agents push game-detection telemetry here (renderer forwards
     * the process monitor's state). Only admitted sockets have data.pcId.
     */
    @SubscribeMessage('agent-status')
    handleAgentStatus(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: { gameActive?: boolean; gameName?: string | null },
    ): void {
        const pcId = client.data.pcId as string | undefined;
        if (!pcId) return;
        const status: AgentStatus = {
            gameActive: Boolean(body?.gameActive),
            gameName: typeof body?.gameName === 'string' ? body.gameName : null,
            updatedAt: new Date(),
        };
        this.agentStatuses.set(pcId, status);
        const userId = client.data.userId as string | undefined;
        if (userId) {
            this.emitToUser(userId, 'agent-status', {
                pcId,
                gameActive: status.gameActive,
                gameName: status.gameName,
            });
        }
    }

    /** Latest telemetry for a device, or null if none reported. */
    getAgentStatus(pcId: string): AgentStatus | null {
        return this.agentStatuses.get(pcId) ?? null;
    }

    /**
     * F&B order placed from the gaming seat. The socket's device-room
     * admission is the auth (only paired agents have data.pcId). Sanity
     * bounds mirror CreateOrderDto; acks back so the client can confirm.
     */
    @SubscribeMessage('place-order')
    async handlePlaceOrder(
        @ConnectedSocket() client: Socket,
        @MessageBody()
        body: { item?: string; qty?: number; amount?: number },
    ): Promise<void> {
        const pcId = client.data.pcId as string | undefined;
        if (!pcId) return;
        const item = typeof body?.item === 'string' ? body.item.slice(0, 80) : '';
        const qty = Number.isInteger(body?.qty) ? Math.min(Math.max(body.qty!, 1), 10) : 1;
        const amount = Number.isInteger(body?.amount)
            ? Math.min(Math.max(body.amount!, 0), 10_000)
            : 0;
        if (!item) return;
        // The pairing owner and café — both set at device admission — ride
        // along for free: the order shows up in the owner's mobile history
        // and is scoped to the right admin's Kitchen Display.
        const userId = client.data.userId as string | undefined;
        const venueId = client.data.venueId as string | undefined;

        try {
            const order = await this.orders.create({ pcId, item, qty, amount, userId, venueId });
            this.logger.log(
                `[ORDER] pcId=${pcId} ${qty}x ${item} ₹${amount} (id=${order.id})`,
            );
            client.emit('order-placed', { id: order.id, item, qty, amount });
        } catch (err) {
            this.logger.error(`[ORDER] failed for pcId=${pcId}: ${(err as Error).message}`);
            client.emit('order-failed', { item });
        }
    }

    /**
     * True when at least one authenticated desktop-agent socket is currently
     * in the device's room — the live "Security Status" signal.
     */
    isDeviceOnline(pcId: string): boolean {
        const room = this.server.sockets.adapter.rooms.get(this.roomFor(pcId));
        return (room?.size ?? 0) > 0;
    }

    /**
     * Emit a control event to every socket registered in the device's room.
     * Designed to be called from REST controllers or other services.
     *
     * @example
     *   gateway.emitToDevice(pcId, 'lock-device', { initiatedBy: userId })
     */
    emitToDevice(
        pcId: string,
        event: DeviceEvent,
        payload: Record<string, unknown> = {},
    ): void {
        const room = this.roomFor(pcId);
        console.log(`Emitting ${event} to room: ${room} (pcId: ${pcId})`);
        // How many sockets are actually in the target room. If this is 0 the
        // emit is a silent no-op — the #1 cause of "API returned 200 but the
        // desktop never reacted" (agent not connected/authed under this pcId).
        const recipients = this.server.sockets.adapter.rooms.get(room)?.size ?? 0;
        this.server.to(room).emit(event, payload);
        this.logger.log(
            `[EMIT] event=${event} room=${room} recipients=${recipients}`,
        );
        if (recipients === 0) {
            this.logger.warn(
                `[EMIT] No sockets in room=${room} — no desktop agent is connected for pcId=${pcId}, so '${event}' was delivered to nobody.`,
            );
        }
    }

    /**
     * Emit a live-update event to every socket in the user's room (the mobile
     * app's user channel). Safe no-op when the user has no connected sockets.
     */
    emitToUser(
        userId: string,
        event: string,
        payload: Record<string, unknown> = {},
    ): void {
        const room = this.userRoomFor(userId);
        const recipients = this.server.sockets.adapter.rooms.get(room)?.size ?? 0;
        this.server.to(room).emit(event, payload);
        this.logger.log(
            `[EMIT] event=${event} room=${room} recipients=${recipients}`,
        );
    }

    // ── Private ────────────────────────────────────────────────────────────────

    /**
     * User-channel admission (mobile app): a bare JWT, no pcId. The socket
     * joins `user:<sub>` and receives live device/order events for that user.
     * Deliberately no EventLog write — CONNECTED/DISCONNECTED are device
     * lifecycle events and user sockets would flood the admin feed.
     */
    private admitUser(client: Socket, token: string): void {
        let payload: JwtPayload;
        try {
            payload = this.jwtService.verify<JwtPayload>(token);
        } catch {
            throw new Error('invalid or expired token');
        }

        const room = this.userRoomFor(payload.sub);
        void client.join(room);
        client.data.userId = payload.sub;
        client.emit('authenticated', { userId: payload.sub });
        this.logger.log(
            `[CONNECT] socketId=${client.id} joined room=${room} (user channel)`,
        );
    }

    /**
     * Verify JWT signature/expiry, then confirm the pcId is owned by the
     * token's subject. Used once device-scoped tokens are issued at pairing.
     */
    private async admitWithToken(
        client: Socket,
        pcId: string,
        token: string,
        venueId?: string,
    ): Promise<void> {
        let payload: JwtPayload;
        try {
            payload = this.jwtService.verify<JwtPayload>(token);
        } catch {
            throw new Error('invalid or expired token');
        }

        const device = await this.prisma.userDevice.findUnique({
            where: { pcId },
            select: { userId: true },
        });

        if (!device) {
            throw new Error(`pcId=${pcId} is not registered`);
        }
        if (device.userId !== payload.sub) {
            throw new Error(`pcId=${pcId} is not owned by userId=${payload.sub}`);
        }

        await this.admit(client, pcId, payload.sub, venueId);
    }

    /**
     * Verify that the pcId exists and has been claimed by a user. The pcId
     * is random enough to be treated as a bearer credential for device auth.
     */
    private async admitByPcId(
        client: Socket,
        pcId: string,
        venueId?: string,
    ): Promise<void> {
        const device = await this.prisma.userDevice.findUnique({
            where: { pcId },
            select: { userId: true },
        });

        if (!device) {
            throw new Error(
                `pcId=${pcId} is not paired — scan the QR code from the mobile app first`,
            );
        }

        await this.admit(client, pcId, device.userId, venueId);
    }

    private async admit(
        client: Socket,
        pcId: string,
        userId: string,
        venueId?: string,
    ): Promise<void> {
        const room = this.roomFor(pcId);
        await client.join(room);
        client.data.pcId = pcId;
        client.data.userId = userId;
        // Stamped by the desktop agent (App.tsx's VENUE_ID) — used to
        // attribute F&B orders placed over this socket to a café (Phase 5
        // admin scoping). Absent for older agent builds; order attribution
        // then just falls back to unscoped.
        if (venueId) client.data.venueId = venueId;
        client.emit('authenticated', { pcId });
        console.log(`🔗 SUCCESS: Device ${pcId} joined room ${room}`);
        this.logger.log(
            `[CONNECT] socketId=${client.id} joined room=${room} userId=${userId}`,
        );
        void this.eventLog.record(pcId, DeviceEventType.CONNECTED);
        this.emitToUser(userId, 'device-connected', { pcId });
    }

    private reject(client: Socket, reason: string, pcId?: string): void {
        console.error(
            `[Handshake] ❌ REJECTED${pcId ? ` pcId=${pcId}` : ''} — ${reason}`,
        );
        this.logger.warn(
            `[REJECT] socketId=${client.id}${pcId ? ` pcId=${pcId}` : ''} — ${reason}`,
        );
        // Audit real auth failures only. An unpaired desktop agent polls the
        // handshake every ~5s while waiting for its QR to be scanned — logging
        // each of those floods event_logs with routine noise.
        if (pcId && !reason.includes('is not paired')) {
            void this.eventLog.record(pcId, DeviceEventType.AUTH_REJECTED, reason);
        }
        client.emit('auth-error', { reason });
        client.disconnect(true);
    }

    private roomFor(pcId: string): string {
        return `device:${pcId}`;
    }

    private userRoomFor(userId: string): string {
        return `user:${userId}`;
    }
}
