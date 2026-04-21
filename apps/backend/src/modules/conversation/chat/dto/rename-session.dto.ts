import { IsBoolean, IsOptional, IsString, Length } from "class-validator";

export class RenameSessionDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  title?: string;

  @IsOptional()
  @IsBoolean()
  debugEnabled?: boolean;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  modelCatalogId?: string;
}
