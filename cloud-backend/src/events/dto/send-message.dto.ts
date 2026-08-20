import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SendMessageDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(128)
    pcId!: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(140)
    message!: string;
}
