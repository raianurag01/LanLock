import apiClient from './client';

/**
 * POST /api/v1/orders
 * Places an F&B order against a paired PC. The backend verifies the caller
 * owns pcId before accepting it (404 otherwise).
 * @returns {Promise<{ id: string, pcId: string, item: string, qty: number, amount: number, status: string }>}
 */
export const placeOrder = async ({ pcId, item, qty, amount }) => {
    const response = await apiClient.post('/orders', { pcId, item, qty, amount });
    return response.data;
};

/**
 * GET /api/v1/orders/mine
 * The caller's own order history, newest first.
 * @returns {Promise<Array<{ id: string, pcId: string, item: string, qty: number, amount: number, status: string, createdAt: string }>>}
 */
export const fetchMyOrders = async () => {
    const response = await apiClient.get('/orders/mine');
    return response.data;
};
