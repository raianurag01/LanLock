import 'dotenv/config';
import { PCStatus, PrismaClient, SessionStatus, UserRole } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';

const BCRYPT_SALT_ROUNDS = 12;

const connectionString = process.env.DATABASE_URL!;
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

interface PcSeed {
    id: string;
    name: string;
    specs: string;
    status?: PCStatus;
}

interface VenueSeed {
    id: string;
    name: string;
    location: string;
    coinRewards?: boolean;
    pcs: PcSeed[];
}

/**
 * Build a numbered PC batch with a status mix so availability counts look
 * alive: the first `online` are ONLINE, then `inUse` IN_USE, rest MAINTENANCE.
 */
const pcBatch = (
    idPrefix: string,
    namePrefix: string,
    specs: string,
    counts: { online: number; inUse: number; maintenance: number },
): PcSeed[] => {
    const total = counts.online + counts.inUse + counts.maintenance;
    return Array.from({ length: total }, (_, idx) => {
        const i = idx + 1;
        const status: PCStatus =
            i <= counts.online
                ? PCStatus.ONLINE
                : i <= counts.online + counts.inUse
                  ? PCStatus.IN_USE
                  : PCStatus.MAINTENANCE;
        const nn = String(i).padStart(2, '0');
        return { id: `${idPrefix}-${nn}`, name: `${namePrefix}-PC-${nn}`, specs, status };
    });
};

const VENUES: VenueSeed[] = [
    {
        id: 'venue-delhi-north-001',
        name: 'LanLock Delhi-North',
        location: 'Delhi, India',
        pcs: [
            { id: 'pc-a01', name: 'A-01', specs: 'RTX 3060' },
            { id: 'pc-a02', name: 'A-02', specs: 'RTX 3060' },
            { id: 'pc-a03', name: 'A-03', specs: 'RTX 4090' },
            { id: 'pc-a04', name: 'A-04', specs: 'Standard' },
            { id: 'pc-a05', name: 'A-05', specs: 'Standard' },
        ],
    },
    // Real partner café (user-provided data). Name must match
    // lanlock-mobile/src/data/venues.js — the Map screen merges live
    // availability into its static venue list by name.
    {
        id: 'venue-lurk-noida-110',
        name: 'LURK Gaming Café',
        location:
            'Shop No. 100A, Upper Ground Floor, Vibe, Sector 110, Noida, Uttar Pradesh 201304',
        coinRewards: true, // LURK's LanCoins loyalty program
        pcs: pcBatch('lurk-pc', 'LURK', 'RTX 4080 · 240Hz · GTA 6 Ready', {
            online: 9,
            inUse: 4,
            maintenance: 2,
        }),
    },
    // Demo placeholder café.
    {
        id: 'venue-respawn-noida-18',
        name: 'Respawn LAN Arena',
        location: '2nd Floor, Galaxy Plaza, Sector 18, Noida',
        pcs: pcBatch('rspwn-pc', 'RSPWN', 'RTX 4070 · 165Hz', {
            online: 14,
            inUse: 5,
            maintenance: 1,
        }),
    },
];

async function main() {
    console.log('🌱 Starting database seed...');

    for (const venueSeed of VENUES) {
        const venue = await prisma.venue.upsert({
            where: { id: venueSeed.id },
            update: { coinRewards: venueSeed.coinRewards ?? false },
            create: {
                id: venueSeed.id,
                name: venueSeed.name,
                location: venueSeed.location,
                coinRewards: venueSeed.coinRewards ?? false,
            },
        });
        console.log(`✅ Venue: ${venue.name}`);

        for (const pc of venueSeed.pcs) {
            await prisma.pCNode.upsert({
                where: { id: pc.id },
                update: {},
                create: {
                    id: pc.id,
                    name: pc.name,
                    specs: pc.specs,
                    status: pc.status ?? PCStatus.OFFLINE,
                    venueId: venue.id,
                },
            });
        }
        console.log(`  ✅ ${venueSeed.pcs.length} PCs seeded`);
    }

    // ── Walk-in sessions ─────────────────────────────────────────────────
    // Café guests without app accounts book at the counter; their PC time is
    // tracked against this shared operational account. Gives every IN_USE
    // station a real ACTIVE Session row so the admin dashboard's per-station
    // meters (elapsed time + ₹ accrued) tick from genuine data.
    const walkIn = await prisma.user.upsert({
        where: { email: 'walkin@lurk.local' },
        update: {},
        create: {
            id: 'user-lurk-walkin',
            email: 'walkin@lurk.local',
            username: 'lurk_walkin',
            // Random unusable password hash — this account can never log in.
            passwordHash: `walkin-${randomUUID()}`,
        },
    });

    const inUsePcs = await prisma.pCNode.findMany({
        where: { status: PCStatus.IN_USE },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
    });
    // Staggered "started X minutes ago" so the dashboard doesn't show
    // identical timers.
    const startedMinutesAgo = [132, 74, 41, 18, 96, 55, 27, 9, 150];
    let created = 0;
    for (const [i, pc] of inUsePcs.entries()) {
        const existing = await prisma.session.findFirst({
            where: { pcNodeId: pc.id, status: SessionStatus.ACTIVE },
        });
        if (existing) continue;
        const minutes = startedMinutesAgo[i % startedMinutesAgo.length];
        await prisma.session.create({
            data: {
                userId: walkIn.id,
                pcNodeId: pc.id,
                status: SessionStatus.ACTIVE,
                startTime: new Date(Date.now() - minutes * 60_000),
            },
        });
        created += 1;
    }
    console.log(
        `✅ Walk-in sessions: ${created} created (${inUsePcs.length - created} already active)`,
    );

    // ── LURK venue admin ─────────────────────────────────────────────────
    // Scoped to venue-lurk-noida-110 — the admin dashboard's venues/orders
    // endpoints filter to this venueId for ADMIN callers, so this account
    // only ever sees LURK, never Respawn or Delhi-North.
    const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'lurkadmin123';
    const adminPasswordHash = await bcrypt.hash(adminPassword, BCRYPT_SALT_ROUNDS);
    await prisma.user.upsert({
        where: { email: 'admin@lurk.local' },
        update: { venueId: 'venue-lurk-noida-110', role: UserRole.ADMIN },
        create: {
            email: 'admin@lurk.local',
            username: 'lurk_admin',
            passwordHash: adminPasswordHash,
            role: UserRole.ADMIN,
            venueId: 'venue-lurk-noida-110',
        },
    });
    console.log(
        `✅ LURK admin: admin@lurk.local / ${adminPassword} (set SEED_ADMIN_PASSWORD to override)`,
    );

    console.log('\n🎉 Seed completed successfully!');
}

main()
    .catch((e) => {
        console.error('❌ Seed error:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
