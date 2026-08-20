// LanLock partner cafés shown on the Map tab.
//
// `name` must match the venue's name in the backend seed
// (cloud-backend/prisma/seed.ts) — MapScreen merges live PC availability from
// GET /venues into this list by name. Fields set to null are hidden in the UI.
export const VENUES = [
    // Real partner café (owner-provided data).
    {
        id: 'venue-1',
        name: 'LURK Gaming Café',
        address:
            'Shop No. 100A, Upper Ground Floor, Vibe, Sector 110, Noida, Uttar Pradesh 201304',
        lat: 28.5372,
        lng: 77.388,
        phone: null,
        hours: null,
        rating: null,
        pcCount: 15,
        pricePerHour: 100,
        packages: [
            { hours: 5, price: 450 },
            { hours: 10, price: 900 },
        ],
        perks: ['GTA 6 Ready', '15 High-End PCs', 'Coin Rewards'],
    },
    // Demo placeholder café.
    {
        id: 'venue-2',
        name: 'Respawn LAN Arena',
        address: '2nd Floor, Galaxy Plaza, Sector 18, Noida',
        lat: 28.5708,
        lng: 77.3212,
        phone: '+91 98100 00002',
        hours: '9:00 AM – 12:00 AM',
        rating: 4.8,
        pcCount: 20,
        pricePerHour: 120,
        packages: [
            { hours: 5, price: 550 },
            { hours: 10, price: 1050 },
        ],
        perks: ['RTX 4070', '165Hz Displays'],
    },
];
