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
import { AuthResponse, AuthService, DeviceResponse, LinkPcResponse } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { LinkPcDto } from './dto/link-pc.dto';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { AuthenticatedUser } from './interfaces/jwt-payload.interface';

// Global prefix 'api/v1' is applied in main.ts, so these resolve to
// /api/v1/auth/*
@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    // Credential endpoints get a strict 5 requests/minute per IP to slow
    // brute-force and account-enumeration attempts.
    @Post('signup')
    @Throttle({ default: { limit: 5, ttl: 60_000 } })
    @HttpCode(HttpStatus.CREATED)
    async signup(@Body() dto: SignupDto): Promise<AuthResponse> {
        return this.authService.signup(dto);
    }

    @Post('login')
    @Throttle({ default: { limit: 5, ttl: 60_000 } })
    @HttpCode(HttpStatus.OK)
    async login(@Body() dto: LoginDto): Promise<AuthResponse> {
        return this.authService.login(dto);
    }

    @Get('me')
    @UseGuards(JwtAuthGuard)
    async me(@CurrentUser() user: AuthenticatedUser) {
        return this.authService.getProfile(user.id);
    }

    @Get('devices')
    @UseGuards(JwtAuthGuard)
    async getDevices(
        @CurrentUser() user: AuthenticatedUser,
    ): Promise<DeviceResponse[]> {
        return this.authService.getDevices(user.id);
    }

    @Post('link-pc')
    @UseGuards(JwtAuthGuard)
    @HttpCode(HttpStatus.CREATED)
    async linkPc(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: LinkPcDto,
    ): Promise<LinkPcResponse> {
        return this.authService.linkPc(user.id, dto.pcId);
    }
}
