import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class SignupDto {
    @IsEmail()
    email!: string;

    @IsString()
    @MinLength(3)
    @MaxLength(30)
    username!: string;

    @IsString()
    @MinLength(8)
    @MaxLength(72) // bcrypt only hashes the first 72 bytes
    password!: string;
}
