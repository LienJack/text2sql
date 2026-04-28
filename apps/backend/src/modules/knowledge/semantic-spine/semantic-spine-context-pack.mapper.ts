import { Injectable } from "@nestjs/common";
import type { RagRetrievalBundle } from "../rag/retrieval/rag-retrieval.types";
import type { SemanticSpineCompileOutput } from "./semantic-spine-compiler.service";

export interface SemanticContextPack {
  status: "ready" | "degraded";
  semantic_version?: number;
  semantic_bindings: SemanticSpineCompileOutput["semanticBindings"];
  instruction_sets: SemanticSpineCompileOutput["instructionSets"];
  confidence: SemanticSpineCompileOutput["confidence"];
  selected_context_summary: {
    count: number;
    snippets: string[];
  };
  risk_tags: string[];
  degrade_reasons: string[];
  evidence: SemanticSpineCompileOutput["evidence"] & {
    retrievalStatus?: "ready" | "degraded";
  };
}

export interface BuildSemanticContextPackInput {
  compileResult: SemanticSpineCompileOutput;
  retrievalBundle?: Pick<RagRetrievalBundle, "status" | "selected_context">;
}

@Injectable()
export class SemanticSpineContextPackMapper {
  mapToContextPack(input: BuildSemanticContextPackInput): SemanticContextPack {
    const selectedContext = input.retrievalBundle?.selected_context ?? [];
    const snippets = selectedContext
      .map((entry) => entry.content?.trim() ?? "")
      .filter((entry) => entry.length > 0)
      .slice(0, 5);
    const degradeReasons: string[] = [];
    if (input.compileResult.status === "degraded") {
      degradeReasons.push(
        input.compileResult.evidence.degradeReason ?? "semantic_spine_unavailable"
      );
    }
    if (input.retrievalBundle?.status === "degraded") {
      degradeReasons.push("retrieval_bundle_degraded");
    }

    return {
      status: input.compileResult.status,
      semantic_version: input.compileResult.semanticVersion,
      semantic_bindings: input.compileResult.semanticBindings,
      instruction_sets: input.compileResult.instructionSets,
      confidence: input.compileResult.confidence,
      selected_context_summary: {
        count: selectedContext.length,
        snippets
      },
      risk_tags: this.unique([
        ...input.compileResult.riskTags,
        ...(input.compileResult.status === "degraded"
          ? ["semantic_spine_degraded"]
          : [])
      ]),
      degrade_reasons: this.unique(degradeReasons),
      evidence: {
        ...input.compileResult.evidence,
        retrievalStatus: input.retrievalBundle?.status
      }
    };
  }

  private unique(values: string[]): string[] {
    return Array.from(
      new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))
    );
  }
}
