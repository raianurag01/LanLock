import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LockPcDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(128)
    pcId!: string;
}
