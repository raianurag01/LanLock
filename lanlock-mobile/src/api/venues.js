import apiClient from './client';

/**
 * GET /api/v1/venues
 * Partner cafés with live PC availability (counts come from PCNode statuses).
 * coinRewards is opt-in per café — LURK has it, others may not.
 * @returns {Promise<Array<{
 *   id: string, name: string, location: string,
 *   pcTotal: number, pcAvailable: number, coinRewards: boolean,
 * }>>}
 */
export const fetchVenues = async () => {
    const response = await apiClient.get('/venues');
    return response.data;
};

/**
 * POST /api/v1/venues/:id/reserve
 * Claims the first available PC at the venue (flips it to IN_USE and opens an
 * ACTIVE session for the caller). 409 when the venue is full.
 * @returns {Promise<{ pcName: string, venueId: string, reservedUntil: string }>}
 */
export const reserveVenuePc = async (venueDbId) => {
    const response = await apiClient.post(`/venues/${venueDbId}/reserve`);
    return response.data;
};
