import apiClient from './client';

export const fetchInventory = async () => {
    try {
        const response = await apiClient.get('/inventory');
        return response.data;
    } catch (error) {
        console.error('Error fetching inventory:', error);
        throw error;
    }
};
