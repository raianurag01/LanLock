import axios from 'axios';
import { API_URL } from './config';
import { deleteToken, getToken } from '../utils/secureStore';

const apiClient = axios.create({
    baseURL: API_URL,
    timeout: 10000,
    headers: {
        'Content-Type': 'application/json',
    },
});

// AuthContext registers its signOut here so a 401 anywhere in the app drops
// the user back to Login. Module-level callback (instead of importing the
// context) avoids a client ↔ context require cycle.
let onUnauthorized = null;
export const setOnUnauthorized = (handler) => {
    onUnauthorized = handler;
};

// Attach the JWT from secure storage to every outgoing request.
apiClient.interceptors.request.use(
    async (config) => {
        const token = await getToken();
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error),
);

// Global 401 handling (mirrors lanlock-admin/src/api.js): the token is dead,
// so delete it and notify AuthContext, then rethrow so the calling screen
// still sees the failure.
apiClient.interceptors.response.use(
    (response) => response,
    async (error) => {
        if (error?.response?.status === 401) {
            await deleteToken().catch(() => {});
            onUnauthorized?.();
        }
        return Promise.reject(error);
    },
);

export default apiClient;
