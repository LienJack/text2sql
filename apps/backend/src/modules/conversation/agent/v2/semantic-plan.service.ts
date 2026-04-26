import { Injectable } from "@nestjs/common";
import type {
  SemanticContextPackV1,
  SemanticPlanV1
} from "@text2sql/shared-types";
import type { SqlSemanticIntent } from "../sql/sql-prompt.builder";
import { SemanticPlanValidator } from "./semantic-plan.validator";

export interface BuildSemanticPlanInput {
  question: string;
  contextPack: SemanticContextPackV1;
  semanticIntent?: SqlSemanticIntent;
  allowedTables?: string[];
}

@Injectable()
export class SemanticPlanService {
  constructor(private readonly validator: SemanticPlanValidator) {}

  build(input: BuildSemanticPlanInput): {
    plan: SemanticPlanV1;
    validation: ReturnType<SemanticPlanValidator["validate"]>;
  } {
    const selectedTables = this.normalizeList(input.contextPack.selectedTables ?? []);
    const selectedColumns = this.normalizeList(input.contextPack.selectedColumns ?? []);
    const allowedTables = this.normalizeList(input.allowedTables ?? []);

    const route = this.resolveRoute({
      semanticIntent: input.semanticIntent,
      selectedTables,
      contextStatus: input.contextPack.status
    });
    const confidence = this.resolveConfidence({
      semanticIntent: input.semanticIntent,
      selectedTables,
      contextStatus: input.contextPack.status,
      warningCount: input.contextPack.warnings?.length ?? 0
    });

    const plan: SemanticPlanV1 = {
      route,
      standaloneQuestion: input.question,
      selectedTables,
      selectedColumns,
      confidence,
      evidenceRefs: input.contextPack.selectedEvidenceIds,
      ...(allowedTables.length > 0 ? { allowedTables } : {}),
      forbiddenTables: selectedTables.filter(
        (table) => allowedTables.length > 0 && !allowedTables.includes(table)
      )
    };

    return {
      plan,
      validation: this.validator.validate({
        plan
      })
    };
  }

  private resolveRoute(input: {
    semanticIntent?: SqlSemanticIntent;
    selectedTables: string[];
    contextStatus: SemanticContextPackV1["status"];
  }): SemanticPlanV1["route"] {
    if (input.semanticIntent === "metadata") {
      return "answer";
    }
    if (input.selectedTables.length === 0 && input.contextStatus === "degraded") {
      return "clarify";
    }
    return "answer";
  }

  private resolveConfidence(input: {
    semanticIntent?: SqlSemanticIntent;
    selectedTables: string[];
    contextStatus: SemanticContextPackV1["status"];
    warningCount: number;
  }): number {
    if (input.semanticIntent === "metadata") {
      return 0.7;
    }
    let base = input.selectedTables.length > 0 ? 0.82 : 0.5;
    if (input.contextStatus === "degraded") {
      base -= 0.18;
    }
    base -= Math.min(0.2, input.warningCount * 0.05);
    return Math.max(0, Math.min(1, Number(base.toFixed(4))));
  }

  private normalizeList(values: string[]): string[] {
    return Array.from(
      new Set(
        values
          .map((value) => this.normalizeIdentifier(value))
          .filter((value): value is string => Boolean(value))
      )
    );
  }

  private normalizeIdentifier(value: string | undefined): string | undefined {
    if (!value) {
      return undefined;
    }
    const normalized = value
      .trim()
      .replace(/^[`"'\[\]]+|[`"'\[\]]+$/g, "")
      .replace(/\s+/g, "")
      .toLowerCase();
    return normalized.length > 0 ? normalized : undefined;
  }
}
