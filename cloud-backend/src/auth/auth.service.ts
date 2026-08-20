import {
    ConflictException,
    Injectable,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import {
    AuthenticatedUser,
    JwtPayload,
} from './interfaces/jwt-payload.interface';

const BCRYPT_SALT_ROUNDS = 12;

/** User fields safe to expose over the API — never includes passwordHash. */
type SafeUser = Omit<User, 'passwordHash'>;

export interface AuthResponse {
    accessToken: string;
    user: SafeUser;
}

export interface LinkPcResponse {
    message: string;
    pcId: string;
}

export interface DeviceResponse {
    id: string;
    pcId: string;
    linkedAt: string;
}

@Injectable()
export class AuthService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly jwtService: JwtService,
        private readonly walletService: WalletService,
    ) {}

    async signup(dto: SignupDto): Promise<AuthResponse> {
        const passwordHash = await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS);

        try {
            const user = await this.prisma.user.create({
                data: {
                    email: dto.email.toLowerCase(),
                    username: dto.username,
                    passwordHash,
                },
            });

            return this.buildAuthResponse(user);
        } catch (error) {
            // P2002 == unique constraint violation (email or username taken).
            if (
                error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2002'
            ) {
                throw new ConflictException(
                    'A user with that email or username already exists',
                );
            }
            throw error;
        }
    }

    async login(dto: LoginDto): Promise<AuthResponse> {
        const user = await this.prisma.user.findUnique({
            where: { email: dto.email.toLowerCase() },
        });

        // Same error whether the email is unknown or the password is wrong,
        // so we don't leak which accounts exist.
        if (!user) {
            throw new UnauthorizedException('Invalid credentials');
        }

        const passwordMatches = await bcrypt.compare(
            dto.password,
            user.passwordHash,
        );
        if (!passwordMatches) {
            throw new UnauthorizedException('Invalid credentials');
        }

        return this.buildAuthResponse(user);
    }

    /** Resolves the profile for the `GET /auth/me` route. */
    async getProfile(userId: string): Promise<SafeUser> {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
        });
        if (!user) {
            throw new UnauthorizedException('User no longer exists');
        }
        return this.toSafeUser(user);
    }

    /**
     * Used by JwtStrategy.validate — returns the authenticated user context
     * or null if the subject no longer exists.
     */
    async validateUserById(userId: string): Promise<AuthenticatedUser | null> {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
        });
        if (!user) {
            return null;
        }
        return {
            id: user.id,
            email: user.email,
            username: user.username,
            role: user.role,
            walletBalance: user.walletBalance,
            venueId: user.venueId,
        };
    }

    /**
     * Throws unless the pcId exists AND is linked to this user. A single 404
     * for both "unknown pcId" and "not yours" avoids leaking which pcIds exist.
     */
    async assertDeviceOwned(userId: string, pcId: string): Promise<void> {
        const device = await this.prisma.userDevice.findUnique({
            where: { pcId },
        });
        if (!device || device.userId !== userId) {
            throw new NotFoundException('No linked PC found for this account');
        }
    }

    /**
     * Releases a pairing at end-of-session so the PC becomes claimable by the
     * next QR scan. Caller must have verified ownership (assertDeviceOwned).
     * deleteMany is a no-op (not an error) if the record is already gone.
     */
    async unlinkPc(pcId: string): Promise<void> {
        await this.prisma.userDevice.deleteMany({ where: { pcId } });
    }

    /** Returns all devices linked to the given user, newest first. */
    async getDevices(userId: string): Promise<DeviceResponse[]> {
        const devices = await this.prisma.userDevice.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
        });
        return devices.map((d) => ({
            id: d.id,
            pcId: d.pcId,
            linkedAt: d.createdAt.toISOString(),
        }));
    }

    /**
     * Links a PC "Lock" (identified by pcId from its pairing QR) to the
     * authenticated user, and opens the billing session for it. Idempotent
     * for the same owner; conflicts if another user already claimed the PC.
     */
    async linkPc(
        userId: string,
        pcId: string,
        venueId?: string,
    ): Promise<LinkPcResponse> {
        // Unknown venueId is stored as null rather than rejected — an older
        // desktop build or a stale QR should never block pairing.
        const resolvedVenueId = venueId
            ? await this.resolveVenueId(venueId)
            : null;

        const existing = await this.prisma.userDevice.findUnique({
            where: { pcId },
        });

        if (existing) {
            if (existing.userId === userId) {
                // Already owned by this user — treat as a no-op success, but
                // still make sure a billing session is open (covers a QR
                // re-scan after an app restart mid-session).
                await this.walletService.openDeviceSession(
                    userId,
                    pcId,
                    resolvedVenueId,
                );
                return { message: 'PC is already linked to your account', pcId };
            }
            throw new ConflictException(
                'This PC is already linked to another account',
            );
        }

        try {
            await this.prisma.userDevice.create({
                data: { pcId, userId },
            });
        } catch (error) {
            // P2002 covers the race where another request claimed the same
            // pcId between our findUnique check and this create.
            if (
                error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2002'
            ) {
                throw new ConflictException(
                    'This PC is already linked to another account',
                );
            }
            throw error;
        }

        await this.walletService.openDeviceSession(userId, pcId, resolvedVenueId);
        return { message: 'PC linked successfully', pcId };
    }

    /** Confirms a venueId exists; returns null (not a throw) if it doesn't. */
    private async resolveVenueId(venueId: string): Promise<string | null> {
        const venue = await this.prisma.venue.findUnique({
            where: { id: venueId },
            select: { id: true },
        });
        return venue?.id ?? null;
    }

    private buildAuthResponse(user: User): AuthResponse {
        const payload: JwtPayload = {
            sub: user.id,
            email: user.email,
            role: user.role,
        };
        return {
            accessToken: this.jwtService.sign(payload),
            user: this.toSafeUser(user),
        };
    }

    /** Strips passwordHash so it can never be serialized into a response. */
    private toSafeUser(user: User): SafeUser {
        const { passwordHash: _passwordHash, ...safe } = user;
        return safe;
    }
}
