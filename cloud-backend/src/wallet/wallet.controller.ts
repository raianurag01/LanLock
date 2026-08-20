import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Post,
    UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { TopupDto } from './dto/topup.dto';
import { WalletService, WalletSummary } from './wallet.service';

// Global prefix 'api/v1' is applied in main.ts → /api/v1/wallet/*
@Controller('wallet')
export class WalletController {
    constructor(private readonly walletService: WalletService) {}

    @Get('summary')
    @UseGuards(JwtAuthGuard)
    async summary(
        @CurrentUser() user: AuthenticatedUser,
    ): Promise<WalletSummary> {
        return this.walletService.getSummary(user.id);
    }

    // Mock payment — no gateway. Throttled like the auth endpoints since it
    // mutates balance directly off a bare amount.
    @Post('topup')
    @UseGuards(JwtAuthGuard)
    @Throttle({ default: { limit: 5, ttl: 60_000 } })
    @HttpCode(HttpStatus.OK)
    async topup(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: TopupDto,
    ): Promise<{ balance: number }> {
        return this.walletService.topup(user.id, dto.amount);
    }
}
