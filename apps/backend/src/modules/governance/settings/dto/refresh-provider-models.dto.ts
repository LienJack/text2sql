import { IsBoolean, IsOptional } from "class-validator";

export class RefreshProviderModelsDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
