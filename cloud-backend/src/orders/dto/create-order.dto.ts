import {
    IsInt,
    IsNotEmpty,
    IsString,
    Max,
    MaxLength,
    Min,
} from 'class-validator';

export class CreateOrderDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(128)
    pcId!: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(80)
    item!: string;

    @IsInt()
    @Min(1)
    @Max(10)
    qty!: number;

    @IsInt()
    @Min(0)
    @Max(10_000)
    amount!: number;
}
