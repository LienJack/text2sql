import { ArrayNotEmpty, ArrayUnique, IsArray, IsString, Length } from "class-validator";

export class BatchDeleteUsersDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  @Length(1, 64, { each: true })
  userIds!: string[];
}
