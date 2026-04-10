import { IsOptional, IsString } from "class-validator";

export class RunEvaluationDto {
  @IsOptional()
  @IsString()
  caseFilePath?: string;
}

