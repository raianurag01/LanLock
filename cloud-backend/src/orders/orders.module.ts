import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
    // forwardRef: EventsModule imports OrdersModule (gateway ingests socket
    // orders) and OrdersService now injects DeviceGateway back (live status
    // push) — a genuine two-module cycle, standard Nest forwardRef idiom.
    imports: [AuthModule, forwardRef(() => EventsModule)],
    controllers: [OrdersController],
    providers: [OrdersService],
    exports: [OrdersService], // EventsModule's gateway ingests socket orders
})
export class OrdersModule {}
