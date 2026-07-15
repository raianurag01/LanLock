import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LinkPcDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(128)
    pcId!: string;
}
