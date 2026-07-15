import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthService } from '../auth.service';
import {
    AuthenticatedUser,
    JwtPayload,
} from '../interfaces/jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(
        configService: ConfigService,
        private readonly authService: AuthService,
    ) {
        const secret = configService.get<string>('JWT_SECRET');
        if (!secret) {
            throw new Error('JWT_SECRET is not configured');
        }

        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: secret,
        });
    }

    /**
     * Passport calls this after verifying the signature/expiry.
     * The returned value is attached to `request.user`.
     */
    async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
        const user = await this.authService.validateUserById(payload.sub);
        if (!user) {
            throw new UnauthorizedException();
        }
        return user;
    }
}
