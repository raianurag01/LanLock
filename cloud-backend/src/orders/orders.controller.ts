import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Patch,
    Post,
    UseGuards,
} from '@nestjs/common';
import { Order, UserRole } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrdersService } from './orders.service';

// Global prefix 'api/v1' is applied in main.ts → /api/v1/orders/*
//
// Primary order intake is the desktop agent's `place-order` socket event
// (device-room authenticated); this REST surface serves the admin Kitchen
// Display and mobile ordering.
@Controller('orders')
export class OrdersController {
    constructor(
        private readonly ordersService: OrdersService,
        private readonly authService: AuthService,
    ) {}

    /**
     * Admin Kitchen Display feed, newest first. A venue-scoped admin sees
     * only their own café's orders (enforced in OrdersService).
     */
    @Get()
    @UseGuards(JwtAuthGuard)
    async recent(@CurrentUser() user: AuthenticatedUser): Promise<Order[]> {
        return this.ordersService.recent(25, user);
    }

    /** The caller's own order history — mobile Orders tab. */
    @Get('mine')
    @UseGuards(JwtAuthGuard)
    async mine(@CurrentUser() user: AuthenticatedUser): Promise<Order[]> {
        return this.ordersService.findMine(user.id);
    }

    @Post()
    @UseGuards(JwtAuthGuard)
    @HttpCode(HttpStatus.CREATED)
    async create(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: CreateOrderDto,
    ): Promise<Order> {
        // GAMERs may only order for a PC they've paired — closes the hole
        // where any authenticated user could place (and bill) an order
        // against an arbitrary pcId. Admins place orders on behalf of the
        // venue (e.g. counter/kiosk flows), so they're exempt.
        if (user.role !== UserRole.ADMIN) {
            await this.authService.assertDeviceOwned(user.id, dto.pcId);
        }
        return this.ordersService.create({ ...dto, userId: user.id });
    }

    @Patch(':id/status')
    @UseGuards(JwtAuthGuard)
    async updateStatus(
        @CurrentUser() user: AuthenticatedUser,
        @Param('id') id: string,
        @Body() dto: UpdateOrderStatusDto,
    ): Promise<Order> {
        return this.ordersService.updateStatus(id, dto.status, user);
    }
}
