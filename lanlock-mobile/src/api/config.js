// Single source of truth for the backend address. Everything that dials the
// backend (axios REST client, legacy fetch client, user socket) imports from
// here so the IP only ever has to change in one place.
//
// ⚠️ DEMO SETUP: run `ipconfig` on the backend Windows machine and copy the
// IPv4 Address here BEFORE every demo — it changes when you switch networks.
const DEMO_IPV4_ADDRESS = '192.168.1.39';
const API_PORT = 3000;

/** Bare origin — used by the socket.io client (no /api prefix). */
export const SERVER_URL = `http://${DEMO_IPV4_ADDRESS}:${API_PORT}`;

/** REST base — global prefix api/v1 is applied in the backend's main.ts. */
export const API_URL = `${SERVER_URL}/api/v1`;
