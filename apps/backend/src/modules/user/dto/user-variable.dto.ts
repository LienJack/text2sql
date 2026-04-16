import { IsString, Length } from "class-validator";

export class UserVariableDto {
  @IsString()
  @Length(1, 64)
  key!: string;

  @IsString()
  @Length(1, 500)
  value!: string;
}
