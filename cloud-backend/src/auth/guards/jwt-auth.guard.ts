import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Guards a route with the 'jwt' passport strategy.
 * Rejects requests without a valid Bearer token with 401.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
