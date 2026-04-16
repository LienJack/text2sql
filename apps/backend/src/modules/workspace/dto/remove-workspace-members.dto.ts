import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsString, Length } from "class-validator";

export class RemoveWorkspaceMembersDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @Length(1, 128, { each: true })
  memberIds!: string[];
}
