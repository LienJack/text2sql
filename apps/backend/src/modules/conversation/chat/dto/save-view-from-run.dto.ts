import { IsOptional, IsString } from "class-validator";

export class SaveViewFromRunDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
