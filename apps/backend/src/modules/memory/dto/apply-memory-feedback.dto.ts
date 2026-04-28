import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import type { RagMemoryStatus } from "@text2sql/shared-types";

const MEMORY_STATUS_VALUES: ReadonlyArray<RagMemoryStatus> = [
  "candidate",
  "verified",
  "production"
];

export class ApplyMemoryFeedbackDto {
  @IsString()
  runId!: string;

  @IsIn(MEMORY_STATUS_VALUES)
  targetStatus!: RagMemoryStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

