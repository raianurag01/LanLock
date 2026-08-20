import apiClient from './client';

/**
 * GET /api/v1/wallet/summary
 * Real wallet state: balance, the caller's active device session (if any,
 * for a server-derived timer), and LanCoins (LURK-only — see coinsEnabled).
 * @returns {Promise<{
 *   balance: number,
 *   activeSession: { pcId: string, startTime: string } | null,
 *   lanCoins: number,
 *   coinsEnabled: boolean,
 *   totalPlayedSeconds: number,
 * }>}
 */
export const fetchWalletSummary = async () => {
    const response = await apiClient.get('/wallet/summary');
    return response.data;
};

/**
 * POST /api/v1/wallet/topup
 * Mock payment — no gateway. amount is ₹, 1-10000.
 * @returns {Promise<{ balance: number }>}
 */
export const topupWallet = async (amount) => {
    const response = await apiClient.post('/wallet/topup', { amount });
    return response.data;
};
