import {
    OnGatewayConnection,
    OnGatewayDisconnect,
    WebSocketGateway,
    WebSocketServer,
} from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

interface GatewayHandshakeAuth {
    pcId?: string;
    token?: string;
}

type DeviceEvent = 'lock-device' | 'unlock-device';

/**
 * Allowed WebSocket origins. FRONTEND_URL may hold a comma-separated list
 * (e.g. "https://app.lanlock.io,http://localhost:5173"). The dev fallbacks
 * cover the API host itself and the electron-vite dev server so the desktop
 * agent keeps working locally. Non-browser clients (no Origin header) are
 * not affected by CORS — the handshake auth below is what gates them.
 */
const ALLOWED_ORIGINS = process.env.FRONTEND_URL
    ? process.env.FRONTEND_URL.split(',').map((o) => o.trim())
    : ['http://localhost:3000', 'http://localhost:5173'];

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

    constructor(
        private readonly jwtService: JwtService,
        private readonly prisma: PrismaService,
    ) {}

    async handleConnection(client: Socket): Promise<void> {
        const { pcId, token } = client.handshake.auth as GatewayHandshakeAuth;

        if (!pcId) {
            this.reject(client, 'missing pcId in handshake auth');
            return;
        }

        try {
            if (token) {
                // Full auth: JWT signature + pcId ownership verified against DB.
                await this.admitWithToken(client, pcId, token);
            } else {
                // Device-only auth: pcId serves as the credential (122-bit UUIDv4,
                // exchanged in-person via QR). Device must already be paired.
                await this.admitByPcId(client, pcId);
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
        this.server.to(room).emit(event, payload);
        this.logger.log(`[EMIT] event=${event} room=${room}`);
    }

    // ── Private ────────────────────────────────────────────────────────────────

    /**
     * Verify JWT signature/expiry, then confirm the pcId is owned by the
     * token's subject. Used once device-scoped tokens are issued at pairing.
     */
    private async admitWithToken(
        client: Socket,
        pcId: string,
        token: string,
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

        await this.admit(client, pcId, payload.sub);
    }

    /**
     * Verify that the pcId exists and has been claimed by a user. The pcId
     * is random enough to be treated as a bearer credential for device auth.
     */
    private async admitByPcId(client: Socket, pcId: string): Promise<void> {
        const device = await this.prisma.userDevice.findUnique({
            where: { pcId },
            select: { userId: true },
        });

        if (!device) {
            throw new Error(
                `pcId=${pcId} is not paired — scan the QR code from the mobile app first`,
            );
        }

        await this.admit(client, pcId, device.userId);
    }

    private async admit(
        client: Socket,
        pcId: string,
        userId: string,
    ): Promise<void> {
        const room = this.roomFor(pcId);
        await client.join(room);
        client.data.pcId = pcId;
        client.data.userId = userId;
        client.emit('authenticated', { pcId });
        this.logger.log(
            `[CONNECT] socketId=${client.id} joined room=${room} userId=${userId}`,
        );
    }

    private reject(client: Socket, reason: string, pcId?: string): void {
        this.logger.warn(
            `[REJECT] socketId=${client.id}${pcId ? ` pcId=${pcId}` : ''} — ${reason}`,
        );
        client.emit('auth-error', { reason });
        client.disconnect(true);
    }

    private roomFor(pcId: string): string {
        return `device:${pcId}`;
    }
}
