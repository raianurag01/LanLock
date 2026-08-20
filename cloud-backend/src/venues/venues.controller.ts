import {
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Post,
    UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import type {
    ReservationResponse,
    VenuePc,
    VenueSummary,
} from './venues.service';
import { VenuesService } from './venues.service';

// Global prefix 'api/v1' is applied in main.ts → /api/v1/venues/*
@Controller('venues')
export class VenuesController {
    constructor(private readonly venuesService: VenuesService) {}

    /**
     * Partner cafés with live PC availability. GAMERs (mobile Map tab) see
     * every café; an ADMIN with a home venue sees only that one.
     */
    @Get()
    @UseGuards(JwtAuthGuard)
    async getVenues(
        @CurrentUser() user: AuthenticatedUser,
    ): Promise<VenueSummary[]> {
        return this.venuesService.getVenues(user);
    }

    /** Per-station statuses for one venue (admin Command Center grid). */
    @Get(':id/pcs')
    @UseGuards(JwtAuthGuard)
    async getVenuePcs(
        @CurrentUser() user: AuthenticatedUser,
        @Param('id') venueId: string,
    ): Promise<VenuePc[]> {
        return this.venuesService.getVenuePcs(venueId, user);
    }

    /** Reserve the first available PC at a venue for the caller. */
    @Post(':id/reserve')
    @UseGuards(JwtAuthGuard)
    @HttpCode(HttpStatus.OK)
    async reserve(
        @CurrentUser() user: AuthenticatedUser,
        @Param('id') venueId: string,
    ): Promise<ReservationResponse> {
        return this.venuesService.reservePc(user.id, venueId);
    }

    /** Admin: end the session on a station and return it to the pool. */
    @Post('pcs/:pcNodeId/release')
    @UseGuards(JwtAuthGuard)
    @HttpCode(HttpStatus.OK)
    async release(
        @CurrentUser() user: AuthenticatedUser,
        @Param('pcNodeId') pcNodeId: string,
    ): Promise<{ pcName: string }> {
        return this.venuesService.releasePc(pcNodeId, user);
    }
}
