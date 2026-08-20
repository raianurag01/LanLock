import { Module } from '@nestjs/common';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

// Deliberately does not import EventsModule (or anything that does) — Auth
// and Events both import WalletModule, so a WalletModule -> EventsModule
// edge would create AuthModule -> WalletModule -> EventsModule -> AuthModule.
@Module({
    controllers: [WalletController],
    providers: [WalletService],
    exports: [WalletService],
})
export class WalletModule {}
