import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL!;
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    console.log('🌱 Starting database seed...');

    // Create venue
    const venue = await prisma.venue.upsert({
        where: { id: 'venue-delhi-north-001' },
        update: {},
        create: {
            id: 'venue-delhi-north-001',
            name: 'LanLock Delhi-North',
            location: 'Delhi, India',
        },
    });

    console.log(`✅ Created venue: ${venue.name}`);

    // Create PCs
    const pcs = [
        { id: 'pc-a01', name: 'A-01', specs: 'RTX 3060' },
        { id: 'pc-a02', name: 'A-02', specs: 'RTX 3060' },
        { id: 'pc-a03', name: 'A-03', specs: 'RTX 4090' },
        { id: 'pc-a04', name: 'A-04', specs: 'Standard' },
        { id: 'pc-a05', name: 'A-05', specs: 'Standard' },
    ];

    for (const pc of pcs) {
        const pcNode = await prisma.pCNode.upsert({
            where: { id: pc.id },
            update: {},
            create: {
                id: pc.id,
                name: pc.name,
                specs: pc.specs,
                venueId: venue.id,
            },
        });
        console.log(`  ✅ Created PC: ${pcNode.name} (${pcNode.specs})`);
    }

    console.log('\n🎉 Seed completed successfully!');
    console.log(`   - 1 Venue: ${venue.name}`);
    console.log(`   - ${pcs.length} PCs created`);
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
