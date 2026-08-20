import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Guards a route with the 'jwt' passport strategy.
 * Rejects requests without a valid Bearer token with 401.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
    // Diagnostic override: requests blocked here never reach the controller,
    // so 401s must be logged at the guard. Behavior is unchanged — the super
    // call still throws UnauthorizedException on failure.
    handleRequest<TUser>(
        err: Error | null,
        user: TUser | false,
        info: Error | undefined,
        context: ExecutionContext,
        status?: unknown,
    ): TUser {
        if (err || !user) {
            console.error(
                '--- 🚫 GUARD BLOCKED: 401 before controller —',
                err?.message ?? info?.message ?? 'no/invalid Bearer token',
            );
        }
        return super.handleRequest(err, user, info, context, status);
    }
}
