import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { WalletModule } from '../wallet/wallet.module';
import { DeviceController } from './device.controller';
import { EventLogService } from './event-log.service';
import { DeviceGateway } from './events.gateway';

@Module({
    // JwtService + AuthService; OrdersModule (forwardRef: see orders.module.ts)
    // for socket order intake + live status push; WalletService for lock-time
    // billing.
    imports: [AuthModule, forwardRef(() => OrdersModule), WalletModule],
    controllers: [DeviceController], // POST /devices/lock injects DeviceGateway (same module)
    providers: [DeviceGateway, EventLogService],
    exports: [DeviceGateway], // REST controllers can inject this to call emitToDevice()
})
export class EventsModule {}
