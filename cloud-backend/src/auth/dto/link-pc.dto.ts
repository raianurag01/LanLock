import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class LinkPcDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(128)
    pcId!: string;

    // Which café this device belongs to (from the desktop agent's QR
    // payload). Optional and additive: older QR payloads without it still
    // pair fine — the session just gets no venue attribution, so LanCoins
    // stays off and the admin can't scope it, both honest fallbacks.
    @IsOptional()
    @IsString()
    @MaxLength(128)
    venueId?: string;
}
