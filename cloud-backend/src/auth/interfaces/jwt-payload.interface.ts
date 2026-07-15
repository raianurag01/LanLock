import { UserRole } from '@prisma/client';

/** Shape of the decoded JWT payload. */
export interface JwtPayload {
    /** Subject — the user id. */
    sub: string;
    email: string;
    role: UserRole;
}

/**
 * The authenticated user attached to `request.user` by JwtStrategy.
 * Deliberately excludes `passwordHash`.
 */
export interface AuthenticatedUser {
    id: string;
    email: string;
    username: string;
    role: UserRole;
    walletBalance: number;
}
