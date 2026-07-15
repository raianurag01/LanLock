import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DeviceGateway } from './events.gateway';

@Module({
    imports: [AuthModule], // provides JwtService (via re-exported JwtModule) + AuthService
    providers: [DeviceGateway],
    exports: [DeviceGateway], // REST controllers can inject this to call emitToDevice()
})
export class EventsModule {}
