import { IsOptional, IsString, Length } from "class-validator";

export class ResetPasswordDto {
  @IsOptional()
  @IsString()
  @Length(8, 120)
  defaultPassword?: string;
}
