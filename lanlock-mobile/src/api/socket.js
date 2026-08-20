import { io } from 'socket.io-client';
import { SERVER_URL } from './config';

/**
 * User-channel socket (mirrors the desktop agent's socket.service.ts, but
 * authenticates with the JWT instead of a pcId). The backend joins us to
 * `user:<id>` and pushes live device/order events:
 *
 *   device-connected    { pcId }
 *   device-disconnected { pcId }
 *   device-locked       { pcId, ...billing }
 *   agent-status        { pcId, gameActive, gameName }
 *   order-updated       { id, item, qty, amount, status }
 *
 * Singleton — AuthContext owns the lifecycle: connect(token) on sign-in,
 * dispose() on sign-out (socket.io replays the handshake auth on every
 * reconnect, so a stale token MUST be disposed, never reused).
 */
class UserSocket {
    constructor() {
        this.socket = null;
        // event name -> Set<listener>
        this.listeners = new Map();
    }

    connect(token) {
        if (this.socket) return;

        this.socket = io(SERVER_URL, {
            auth: { token },
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1_000,
            reconnectionDelayMax: 30_000,
            randomizationFactor: 0.5,
            transports: ['websocket'],
        });

        this.socket
            .on('connect_error', (err) =>
                console.log('[socket] connect failed:', err.message),
            )
            .on('authenticated', () => console.log('[socket] user channel joined'))
            .on('auth-error', (data) =>
                console.log('[socket] auth rejected:', data?.reason),
            );

        // Fan every known event out to whoever registered via on().
        ['device-connected', 'device-disconnected', 'device-locked', 'agent-status', 'order-updated']
            .forEach((event) => {
                this.socket.on(event, (payload) => {
                    const subs = this.listeners.get(event);
                    if (subs) subs.forEach((listener) => listener(payload));
                });
            });
    }

    dispose() {
        this.socket?.off();
        this.socket?.disconnect();
        this.socket = null;
    }

    /** Subscribe to a server event. Returns nothing — pair with off(). */
    on(event, listener) {
        if (!this.listeners.has(event)) this.listeners.set(event, new Set());
        this.listeners.get(event).add(listener);
    }

    off(event, listener) {
        this.listeners.get(event)?.delete(listener);
    }
}

export const userSocket = new UserSocket();
