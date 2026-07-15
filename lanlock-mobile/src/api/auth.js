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
 * apiClient request interceptor.
 * @returns {Promise<{ message: string, pcId: string }>}
 */
export const linkPc = async (pcId) => {
    const response = await apiClient.post('/auth/link-pc', { pcId });
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
