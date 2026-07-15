// API client for LanLock cloud backend
const API_BASE_URL = 'http://10.0.2.2:3000/api/v1'; // Android emulator localhost

export const api = {
    // Fetch inventory of available PCs
    async getInventory() {
        const response = await fetch(`${API_BASE_URL}/inventory`);
        if (!response.ok) {
            throw new Error('Failed to fetch inventory');
        }
        return response.json();
    },

    // Health check
    async healthCheck() {
        const response = await fetch(`${API_BASE_URL}/health`);
        return response.json();
    },
};

export default api;
