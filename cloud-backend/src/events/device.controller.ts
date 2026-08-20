import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Post,
    UseGuards,
} from '@nestjs/common';
import { DeviceEventType } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { WalletService } from '../wallet/wallet.service';
import { LockPcDto } from './dto/lock-pc.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { EventLogService } from './event-log.service';
import { DeviceGateway } from './events.gateway';

export type SecurityStatus = 'PROTECTED' | 'AT_RISK' | 'STANDBY';

export interface DeviceSummaryResponse {
    securityStatus: SecurityStatus;
    lastLockedAt: string | null;
    devices: Array<{
        pcId: string;
        online: boolean;
        gameActive: boolean;
        gameName: string | null;
    }>;
}

// Global prefix 'api/v1' is applied in main.ts, so this resolves to
// /api/v1/devices/*
@Controller('devices')
export class DeviceController {
    constructor(
        private readonly gateway: DeviceGateway,
        private readonly authService: AuthService,
        private readonly eventLog: EventLogService,
        private readonly walletService: WalletService,
    ) {}

    /**
     * Emits `lock-device` to the paired desktop agent's socket room. Verifies
     * the caller owns the pcId first, then hands off to the gateway (both live
     * in EventsModule, so no cross-module/circular wiring is needed).
     */
    @Post('lock')
    @UseGuards(JwtAuthGuard)
    @HttpCode(HttpStatus.OK)
    async lock(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: LockPcDto,
    ): Promise<{
        message: string;
        pcId: string;
        sessionSeconds?: number;
        amountCharged?: number;
        newBalance?: number;
    }> {
        console.log('--- 🚪 FRONT DOOR HIT: Received lock request ---');
        console.log('--- 📦 Request Data:', JSON.stringify(dto));
        console.log('--- 👤 Authenticated user:', user.id);
        await this.authService.assertDeviceOwned(user.id, dto.pcId);
        this.gateway.emitToDevice(dto.pcId, 'lock-device', {
            initiatedBy: user.id,
        });
        // detail = initiator userId: the pairing row is deleted just below, so
        // this is what lets /devices/summary find the user's last lock later.
        void this.eventLog.record(dto.pcId, DeviceEventType.LOCKED, user.id);
        // Close the billing session BEFORE releasing the pairing below — the
        // session is keyed on userId+pcId (survives unlinkPc either way),
        // but closing first keeps the invariant "no ACTIVE session without a
        // pairing" and avoids a window where a crash between the two calls
        // strands an open session. Best-effort: billing failure never blocks
        // the lock (see WalletService.closeDeviceSession).
        const billing = await this.walletService.closeDeviceSession(
            user.id,
            dto.pcId,
        );
        // End-of-session semantics: release the pairing so the desktop drops
        // back to its QR screen and the PC is claimable by the next scan.
        await this.authService.unlinkPc(dto.pcId);
        // Live update to the owner's mobile app (user channel).
        this.gateway.emitToUser(user.id, 'device-locked', {
            pcId: dto.pcId,
            ...billing,
        });
        return {
            message: 'Lock command sent',
            pcId: dto.pcId,
            ...billing,
        };
    }

    /**
     * Push a short text message onto the paired PC's screen (the desktop
     * renderer listens for `display-message` and shows it as a banner).
     */
    @Post('message')
    @UseGuards(JwtAuthGuard)
    @HttpCode(HttpStatus.OK)
    async message(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: SendMessageDto,
    ): Promise<{ message: string; pcId: string; delivered: boolean }> {
        await this.authService.assertDeviceOwned(user.id, dto.pcId);
        this.gateway.emitToDevice(dto.pcId, 'display-message', {
            message: dto.message,
            from: user.username,
        });
        return {
            message: 'Message sent',
            pcId: dto.pcId,
            delivered: this.gateway.isDeviceOnline(dto.pcId),
        };
    }

    /**
     * Newest-first audit trail for the admin dashboard's Activity Feed.
     */
    @Get('events')
    @UseGuards(JwtAuthGuard)
    async events(): Promise<
        Array<{
            id: string;
            pcId: string;
            type: string;
            detail: string | null;
            createdAt: Date;
        }>
    > {
        const rows = await this.eventLog.recent(20);
        return rows.map((e) => ({
            id: e.id,
            pcId: e.pcId,
            type: e.type,
            detail: e.detail,
            createdAt: e.createdAt,
        }));
    }

    /**
     * Live security posture for the caller's paired devices, driven by real
     * data: gateway room occupancy (is the desktop agent connected right now?)
     * and the event_logs audit trail (when did this user last lock a PC?).
     */
    @Get('summary')
    @UseGuards(JwtAuthGuard)
    async summary(
        @CurrentUser() user: AuthenticatedUser,
    ): Promise<DeviceSummaryResponse> {
        const [devices, lastLocked] = await Promise.all([
            this.authService.getDevices(user.id),
            this.eventLog.lastLockedByUser(user.id),
        ]);

        const deviceStates = devices.map((d) => {
            const agent = this.gateway.getAgentStatus(d.pcId);
            return {
                pcId: d.pcId,
                online: this.gateway.isDeviceOnline(d.pcId),
                gameActive: agent?.gameActive ?? false,
                gameName: agent?.gameName ?? null,
            };
        });

        let securityStatus: SecurityStatus;
        if (deviceStates.length === 0) {
            securityStatus = 'STANDBY';
        } else if (deviceStates.some((d) => d.online)) {
            securityStatus = 'PROTECTED';
        } else {
            securityStatus = 'AT_RISK';
        }

        return {
            securityStatus,
            lastLockedAt: lastLocked?.createdAt.toISOString() ?? null,
            devices: deviceStates,
        };
    }
}
