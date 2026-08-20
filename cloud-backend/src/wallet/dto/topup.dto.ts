import { IsInt, Max, Min } from 'class-validator';

export class TopupDto {
    // Mock payment — no gateway. Bounded to keep the demo data sane.
    @IsInt()
    @Min(1)
    @Max(10_000)
    amount!: number;
}
