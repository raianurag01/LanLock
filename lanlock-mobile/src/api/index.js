// API client for LanLock cloud backend
import { API_URL } from './config';

export const api = {
    // Fetch inventory of available PCs
    async getInventory() {
        const response = await fetch(`${API_URL}/inventory`);
        if (!response.ok) {
            throw new Error('Failed to fetch inventory');
        }
        return response.json();
    },

    // Health check
    async healthCheck() {
        const response = await fetch(`${API_URL}/health`);
        return response.json();
    },
};

export default api;
