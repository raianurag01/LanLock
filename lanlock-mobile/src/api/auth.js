import apiClient from './client';

/**
 * Pulls a human-readable message out of an axios error so screens can
 * surface the backend's message (e.g. "Invalid credentials") instead of a
 * generic string. NestJS validation errors arrive as `message: string[]`.
 */
export const getApiErrorMessage = (error, fallback = 'Something went wrong') => {
    const data = error?.response?.data;
    if (data?.message) {
        return Array.isArray(data.message) ? data.message[0] : data.message;
    }
    if (error?.code === 'ECONNABORTED') {
        return 'Request timed out. Check your connection and try again.';
    }
    if (error?.message === 'Network Error') {
        return 'Cannot reach the server. Is the backend running?';
    }
    return fallback;
};

/**
 * POST /api/v1/auth/login
 * @returns {Promise<{ accessToken: string, user: object }>}
 */
export const login = async ({ email, password }) => {
    const response = await apiClient.post('/auth/login', { email, password });
    return response.data;
};

/**
 * POST /api/v1/auth/signup
 * @returns {Promise<{ accessToken: string, user: object }>}
 */
export const signup = async ({ email, username, password }) => {
    const response = await apiClient.post('/auth/signup', {
        email,
        username,
        password,
    });
    return response.data;
};

/**
 * POST /api/v1/auth/link-pc
 * The Authorization: Bearer <token> header is attached automatically by the
 * apiClient request interceptor. venueId (from the QR payload) opens the
 * billing session at the right café — optional, older QR codes omit it.
 * @returns {Promise<{ message: string, pcId: string }>}
 */
export const linkPc = async (pcId, venueId) => {
    const response = await apiClient.post('/auth/link-pc', { pcId, venueId });
    return response.data;
};

/**
 * GET /api/v1/auth/me
 * The authenticated user's profile (username chosen at signup, etc.).
 * @returns {Promise<{ id: string, email: string, username: string, role: string, walletBalance: number }>}
 */
export const fetchMe = async () => {
    const response = await apiClient.get('/auth/me');
    return response.data;
};

/**
 * GET /api/v1/auth/devices
 * Returns all UserDevice records linked to the authenticated user.
 * @returns {Promise<Array<{ id: string, pcId: string, linkedAt: string }>>}
 */
export const fetchDevices = async () => {
    const response = await apiClient.get('/auth/devices');
    return response.data;
};

/**
 * POST /api/v1/devices/message
 * Pushes a short text message onto the paired PC's screen via the desktop
 * agent's socket. 140-char limit enforced server-side.
 * @returns {Promise<{ message: string, pcId: string, delivered: boolean }>}
 */
export const pushMessageToPc = async (pcId, message) => {
    const response = await apiClient.post('/devices/message', { pcId, message });
    return response.data;
};

/**
 * GET /api/v1/devices/summary
 * Live security posture: real desktop-agent connectivity (gateway room
 * occupancy) + the user's most recent lock from the event_logs audit trail.
 * @returns {Promise<{
 *   securityStatus: 'PROTECTED' | 'AT_RISK' | 'STANDBY',
 *   lastLockedAt: string | null,
 *   devices: Array<{ pcId: string, online: boolean }>,
 * }>}
 */
export const fetchDeviceSummary = async () => {
    const response = await apiClient.get('/devices/summary');
    return response.data;
};

/**
 * POST /api/v1/devices/lock
 * Emits the `lock-device` WebSocket event to the paired desktop agent, and
 * closes + bills the device's active session (see WalletService).
 * The Authorization: Bearer <token> header is attached automatically by the
 * apiClient request interceptor.
 * @returns {Promise<{
 *   message: string, pcId: string,
 *   sessionSeconds?: number, amountCharged?: number, newBalance?: number,
 * }>}
 */
export const lockPc = async (pcId) => {
    // Diagnostic: print the exact URL this request targets so it can be
    // compared 1:1 against the backend's mapped route (POST /api/v1/devices/lock).
    console.log('lockPc → POST', `${apiClient.defaults.baseURL}/devices/lock`, 'pcId:', pcId);
    const response = await apiClient.post('/devices/lock', { pcId });
    return response.data;
};
