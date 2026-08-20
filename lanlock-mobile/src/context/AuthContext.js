import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from 'react';
import { fetchMe } from '../api/auth';
import { setOnUnauthorized } from '../api/client';
import { userSocket } from '../api/socket';
import { initNotifications, notify } from '../utils/notifications';
import { deleteToken, getToken, saveToken } from '../utils/secureStore';

// Map live socket events → local notification copy. Home/Orders screens do
// their own data refresh; this only surfaces the banner. Stable function
// references + a one-time guard, because startSession() can run more than
// once per app lifetime (bootstrap, then a later sign-in after sign-out) and
// userSocket.on() never dedupes — re-registering closures here would stack
// duplicate notifications on every event.
const notifyDeviceConnected = () =>
    notify('PC online', 'Your LanLock agent is connected.');
const notifyDeviceDisconnected = () =>
    notify('PC offline', 'Your LanLock agent went offline.');
const notifyDeviceLocked = () => notify('PC locked', 'Your session has ended.');
const notifyOrderUpdated = (payload) =>
    notify(payload?.item ?? 'Order update', `Status: ${payload?.status ?? 'updated'}`);

let notificationsWired = false;
const wireSocketNotifications = () => {
    if (notificationsWired) return;
    notificationsWired = true;
    userSocket.on('device-connected', notifyDeviceConnected);
    userSocket.on('device-disconnected', notifyDeviceDisconnected);
    userSocket.on('device-locked', notifyDeviceLocked);
    userSocket.on('order-updated', notifyOrderUpdated);
};

/**
 * Session state for the whole app:
 * - 'loading'   — bootstrap in flight (checking SecureStore for a JWT)
 * - 'signedIn'  — valid token present; App.js mounts the Main/Scan stack
 * - 'signedOut' — no token (or it was rejected); App.js mounts Login/Signup
 */
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [status, setStatus] = useState('loading');
    // Profile from /auth/me (username, walletBalance, …). May be null while
    // signedIn if the bootstrap fetch hit a network error — screens already
    // degrade gracefully without it.
    const [user, setUser] = useState(null);

    // Bring the live channel up for a token. Idempotent (userSocket.connect
    // is a no-op if already connected).
    const startSession = useCallback((token) => {
        void initNotifications();
        wireSocketNotifications();
        userSocket.connect(token);
    }, []);

    const signOut = useCallback(async () => {
        userSocket.dispose();
        await deleteToken().catch(() => {
            // Best-effort: a keystore failure must not trap the user in the
            // signed-in stack.
        });
        setUser(null);
        setStatus('signedOut');
    }, []);

    const signIn = useCallback(
        async (accessToken, profile) => {
            await saveToken(accessToken);
            startSession(accessToken);
            setUser(profile ?? null);
            setStatus('signedIn');
        },
        [startSession],
    );

    // Any API call that comes back 401 (expired/invalid token) drops the
    // whole app back to Login. Registered once for the app's lifetime.
    useEffect(() => {
        setOnUnauthorized(() => {
            userSocket.dispose();
            setUser(null);
            setStatus('signedOut');
        });
        return () => setOnUnauthorized(null);
    }, []);

    // Bootstrap: restore the session from SecureStore so a valid token skips
    // the Login screen entirely.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const token = await getToken().catch(() => null);
            if (!token) {
                if (!cancelled) setStatus('signedOut');
                return;
            }
            try {
                const profile = await fetchMe();
                if (!cancelled) {
                    startSession(token);
                    setUser(profile);
                    setStatus('signedIn');
                }
            } catch (err) {
                if (cancelled) return;
                if (err?.response?.status === 401) {
                    // Token rejected — the client interceptor already deleted
                    // it; make sure state agrees.
                    setUser(null);
                    setStatus('signedOut');
                } else {
                    // Network error / backend down: keep the user signed in
                    // with no profile rather than stranding them on Login.
                    startSession(token);
                    setStatus('signedIn');
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [startSession]);

    const value = useMemo(
        () => ({ status, user, setUser, signIn, signOut }),
        [status, user, signIn, signOut],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) {
        throw new Error('useAuth must be used inside <AuthProvider>');
    }
    return ctx;
}
