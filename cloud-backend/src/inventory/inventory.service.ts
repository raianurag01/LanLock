import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class InventoryService {
    constructor(private prisma: PrismaService) { }

    async getAllPCs() {
        const pcNodes = await this.prisma.pCNode.findMany({
            orderBy: { name: 'asc' },
        });

        return pcNodes.map((pc) => ({
            id: pc.id,
            name: pc.name,
            specs: pc.specs || 'Standard',
            status: pc.status === 'ONLINE' ? 'AVAILABLE' : pc.status,
        }));
    }
}
