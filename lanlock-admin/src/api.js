// Thin fetch wrapper for the LanLock backend. Token lives in localStorage;
// a 401 clears it so the app falls back to the login screen.
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1';

const TOKEN_KEY = 'lanlock.admin.token';

// Stable seeded id — cloud-backend/prisma/seed.ts.
export const LURK_VENUE_ID = 'venue-lurk-noida-110';
export const RATE_PER_HOUR = 100; // ₹, matches LURK pricing

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token) => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const request = async (path, options = {}) => {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (res.status === 401) {
    clearToken();
    throw new ApiError('Session expired — please sign in again', 401);
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.message) {
        message = Array.isArray(body.message) ? body.message[0] : body.message;
      }
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message, res.status);
  }
  return res.json();
};

export const login = async (email, password) => {
  const data = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setToken(data.accessToken);
  return data.user;
};

export const getVenues = () => request('/venues');
export const getVenuePcs = (venueId = LURK_VENUE_ID) =>
  request(`/venues/${venueId}/pcs`);
export const getEvents = () => request('/devices/events');
export const getSummary = () => request('/devices/summary');
export const getOrders = () => request('/orders');
export const setOrderStatus = (orderId, status) =>
  request(`/orders/${orderId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
export const releasePc = (pcNodeId) =>
  request(`/venues/pcs/${pcNodeId}/release`, { method: 'POST' });
export const lockDevice = (pcId) =>
  request('/devices/lock', { method: 'POST', body: JSON.stringify({ pcId }) });
