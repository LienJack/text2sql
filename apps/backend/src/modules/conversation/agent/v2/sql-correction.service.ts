import { Injectable } from "@nestjs/common";

export interface SqlCorrectionDecision {
  correctable: boolean;
  reason: string;
  maxAttempts: number;
}

const CORRECTABLE_ERROR_MARKERS = [
  "syntax",
  "missing column",
  "unknown column",
  "dialect",
  "join path",
  "relationship"
];

@Injectable()
export class SqlCorrectionService {
  readonly maxAttempts = 2;

  decide(error: unknown): SqlCorrectionDecision {
    const message = error instanceof Error ? error.message : String(error ?? "");
    const normalized = message.trim().toLowerCase();
    const correctable = CORRECTABLE_ERROR_MARKERS.some((marker) =>
      normalized.includes(marker)
    );
    return {
      correctable,
      reason: normalized || "unknown",
      maxAttempts: this.maxAttempts
    };
  }
}
