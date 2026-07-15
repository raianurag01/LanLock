import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';

/**
 * Extracts the authenticated user (attached by JwtStrategy) from the request.
 * Only meaningful on routes protected by JwtAuthGuard.
 */
export const CurrentUser = createParamDecorator(
    (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
        const request = ctx
            .switchToHttp()
            .getRequest<Request & { user: AuthenticatedUser }>();
        return request.user;
    },
);
