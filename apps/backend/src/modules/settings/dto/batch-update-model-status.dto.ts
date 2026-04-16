import { IsArray, IsBoolean, IsString } from "class-validator";

export class BatchUpdateModelStatusDto {
  @IsArray()
  @IsString({ each: true })
  modelIds!: string[];

  @IsBoolean()
  enabled!: boolean;
}
