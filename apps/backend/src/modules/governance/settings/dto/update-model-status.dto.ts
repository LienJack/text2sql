import { IsBoolean } from "class-validator";

export class UpdateModelStatusDto {
  @IsBoolean()
  enabled!: boolean;
}
