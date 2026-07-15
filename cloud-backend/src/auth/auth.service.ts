import {
    ConflictException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
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
        };
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
     * authenticated user. Idempotent for the same owner; conflicts if another
     * user already claimed the PC.
     */
    async linkPc(userId: string, pcId: string): Promise<LinkPcResponse> {
        const existing = await this.prisma.userDevice.findUnique({
            where: { pcId },
        });

        if (existing) {
            if (existing.userId === userId) {
                // Already owned by this user — treat as a no-op success.
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

        return { message: 'PC linked successfully', pcId };
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
