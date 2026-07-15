import axios from 'axios';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { getToken } from '../utils/secureStore';

const API_PORT = 3000;

/**
 * Resolve the backend host.
 *
 * In development the app is served by Metro, whose host URI is the dev
 * machine's LAN IP (e.g. "192.168.1.4:8081"). Reusing that IP means the API
 * is reachable from a physical device AND an emulator on the same network,
 * without hardcoding an address that changes between networks.
 *
 * Falls back to the Android-emulator loopback alias / localhost if Metro's
 * host is unavailable (e.g. a production build — set an explicit URL there).
 */
function resolveApiHost() {
    const hostUri =
        Constants.expoConfig?.hostUri ??
        Constants.expoGoConfig?.debuggerHost ??
        '';
    const host = hostUri.split(':')[0];
    if (host) {
        return host;
    }
    return Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
}

const API_URL = `http://${resolveApiHost()}:${API_PORT}/api/v1`;

const apiClient = axios.create({
    baseURL: API_URL,
    timeout: 10000,
    headers: {
        'Content-Type': 'application/json',
    },
});

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

export default apiClient;
