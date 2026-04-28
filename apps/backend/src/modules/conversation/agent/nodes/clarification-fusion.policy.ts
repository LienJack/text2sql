import { Injectable } from "@nestjs/common";
import type {
  ClarificationDecision,
  ClarificationDecisionEvidence,
  ClarificationSlotKey
} from "@text2sql/shared-types";
import { AppConfigService } from "../../../config/app-config.service";
import type {
  ClarificationSemanticEvaluationResult
} from "./clarification-semantic-evaluator.service";
import type { SlotFillingDecision } from "./slot-filling-context";

export interface ClarificationFusionInput {
  ruleDecision: ClarificationDecisionEvidence;
  semanticEvaluation?: ClarificationSemanticEvaluationResult;
}

export interface ClarificationFusionResult {
  decision: ClarificationDecisionEvidence;
  metadata: {
    mode: "rules-only" | "hybrid";
    semanticRequested: boolean;
    semanticUsed: boolean;
    fallbackApplied: boolean;
    fallbackReason?: "disabled" | "kill-switch" | "timeout" | "error" | "invalid_payload";
    strictModeReasons: string[];
    stageRiskTags: {
      rule: string[];
      semantic: string[];
      fusion: string[];
    };
  };
}

export const mapRuleDecisionToEvidence = (
  ruleDecision: SlotFillingDecision
): ClarificationDecisionEvidence => {
  const decision: ClarificationDecision =
    ruleDecision.decision === "clarify" ? "clarify" : "continue";
  const missingCriticalSlots: ClarificationSlotKey[] =
    ruleDecision.missingCriticalSlots ?? ruleDecision.missingSlots ?? [];

  return {
    decision,
    triggerPath: "rule",
    decisionSource: ruleDecision.decisionSource,
    bypassed: ruleDecision.bypassed,
    bypassReasonCode: ruleDecision.bypassReasonCode,
    confidenceLevel: ruleDecision.confidence,
    missingCriticalSlots,
    conflictDetected: false,
    reasonCodes: buildRuleReasonCodes(ruleDecision),
    question: ruleDecision.question,
    reason: ruleDecision.reason
  };
};

const buildRuleReasonCodes = (ruleDecision: SlotFillingDecision): string[] => {
  const reasonCodes: string[] = [
    `rule_source_${ruleDecision.source}`,
    `rule_confidence_${ruleDecision.confidence}`,
    ...(ruleDecision.reasonCodes ?? [])
  ];
  for (const slot of ruleDecision.missingCriticalSlots ?? []) {
    reasonCodes.push(`rule_missing_${slot}`);
  }
  return unique(reasonCodes);
};

@Injectable()
export class ClarificationFusionPolicy {
  constructor(private readonly appConfig: AppConfigService) {}

  shouldArbitrate(ruleDecision: ClarificationDecisionEvidence): boolean {
    if (this.appConfig.clarificationRulesOnlyKillSwitch) {
      return false;
    }
    if (!this.appConfig.clarificationHybridEnabled) {
      return false;
    }
    if (ruleDecision.bypassed || ruleDecision.decisionSource === "metadata-intent" || ruleDecision.decisionSource === "sql-write-intent") {
      return false;
    }
    return (
      ruleDecision.confidenceLevel === "low" ||
      Boolean(ruleDecision.conflictDetected) ||
      Boolean(ruleDecision.reasonCodes?.includes("rule_confidence_low"))
    );
  }

  fuse(input: ClarificationFusionInput): ClarificationFusionResult {
    const ruleDecision = this.normalizeRuleDecision(input.ruleDecision);
    const semanticEvaluation = input.semanticEvaluation;

    const hybridDisabled = !this.appConfig.clarificationHybridEnabled;
    const rulesOnlyEnabled = this.appConfig.clarificationRulesOnlyKillSwitch;

    if (hybridDisabled || rulesOnlyEnabled) {
      return {
        decision: {
          ...ruleDecision,
          triggerPath: "rule",
          reasonCodes: unique([
            ...(ruleDecision.reasonCodes ?? []),
            hybridDisabled ? "hybrid_disabled" : "rules_only_kill_switch"
          ])
        },
        metadata: {
          mode: "rules-only",
          semanticRequested: false,
          semanticUsed: false,
          fallbackApplied: true,
          fallbackReason: hybridDisabled ? "disabled" : "kill-switch",
          strictModeReasons: this.buildStrictModeReasons(ruleDecision),
          stageRiskTags: {
            rule: this.toStageRiskTags("rule", ruleDecision.reasonCodes),
            semantic: [],
            fusion: [hybridDisabled ? "fusion:hybrid_disabled" : "fusion:rules_only_kill_switch"]
          }
        }
      };
    }

    if (!semanticEvaluation) {
      return {
        decision: ruleDecision,
        metadata: {
          mode: "hybrid",
          semanticRequested: false,
          semanticUsed: false,
          fallbackApplied: false,
          strictModeReasons: this.buildStrictModeReasons(ruleDecision),
          stageRiskTags: {
            rule: this.toStageRiskTags("rule", ruleDecision.reasonCodes),
            semantic: [],
            fusion: []
          }
        }
      };
    }

    if (semanticEvaluation.status !== "success" || !semanticEvaluation.decision) {
      const fallbackReason =
        semanticEvaluation.metadata.fallbackReason ?? this.mapFallbackReason(semanticEvaluation);
      return {
        decision: {
          ...ruleDecision,
          triggerPath: "hybrid",
          reasonCodes: unique([
            ...(ruleDecision.reasonCodes ?? []),
            `semantic_fallback_${fallbackReason}`
          ])
        },
        metadata: {
          mode: "hybrid",
          semanticRequested: true,
          semanticUsed: false,
          fallbackApplied: true,
          fallbackReason,
          strictModeReasons: this.buildStrictModeReasons(ruleDecision),
          stageRiskTags: {
            rule: this.toStageRiskTags("rule", ruleDecision.reasonCodes),
            semantic: this.toStageRiskTags("semantic", semanticEvaluation.reasonCodes),
            fusion: [`fusion:semantic_fallback_${fallbackReason}`]
          }
        }
      };
    }

    const semanticDecision = this.normalizeSemanticDecision(semanticEvaluation.decision);
    const conflictDetected = ruleDecision.decision !== semanticDecision.decision;
    const finalDecision = this.resolveConflict(ruleDecision, semanticDecision, conflictDetected);

    const mergedReasonCodes = unique([
      ...(finalDecision.reasonCodes ?? []),
      ...(semanticDecision.reasonCodes ?? []),
      conflictDetected
        ? `fusion_conflict_resolved_${finalDecision.decision ?? "continue"}`
        : "fusion_semantic_confirmed"
    ]);

    const decision: ClarificationDecisionEvidence = {
      ...finalDecision,
      triggerPath: "hybrid",
      conflictDetected,
      reasonCodes: mergedReasonCodes
    };

    return {
      decision,
      metadata: {
        mode: "hybrid",
        semanticRequested: true,
        semanticUsed: true,
        fallbackApplied: false,
        strictModeReasons: this.buildStrictModeReasons(decision),
        stageRiskTags: {
          rule: this.toStageRiskTags("rule", ruleDecision.reasonCodes),
          semantic: this.toStageRiskTags("semantic", semanticDecision.reasonCodes),
          fusion: conflictDetected
            ? ["fusion:rule_semantic_conflict"]
            : ["fusion:rule_semantic_agree"]
        }
      }
    };
  }

  private normalizeRuleDecision(
    decision: ClarificationDecisionEvidence
  ): ClarificationDecisionEvidence {
    return {
      decision: decision.decision === "clarify" ? "clarify" : "continue",
      triggerPath: "rule",
      decisionSource: decision.decisionSource,
      bypassed: decision.bypassed,
      bypassReasonCode: decision.bypassReasonCode,
      confidenceLevel: this.normalizeConfidenceLevel(decision.confidenceLevel),
      missingCriticalSlots: this.normalizeSlots(decision.missingCriticalSlots),
      conflictDetected: Boolean(decision.conflictDetected),
      reasonCodes: unique(decision.reasonCodes ?? []),
      question: decision.question,
      reason: decision.reason
    };
  }

  private normalizeSemanticDecision(
    decision: ClarificationDecisionEvidence
  ): ClarificationDecisionEvidence {
    return {
      decision: decision.decision === "clarify" ? "clarify" : "continue",
      triggerPath: "semantic",
      decisionSource: decision.decisionSource,
      bypassed: decision.bypassed,
      bypassReasonCode: decision.bypassReasonCode,
      confidenceLevel: this.normalizeConfidenceLevel(decision.confidenceLevel),
      missingCriticalSlots: this.normalizeSlots(decision.missingCriticalSlots),
      conflictDetected: Boolean(decision.conflictDetected),
      reasonCodes: unique(decision.reasonCodes ?? []),
      question: decision.question,
      reason: decision.reason
    };
  }

  private resolveConflict(
    ruleDecision: ClarificationDecisionEvidence,
    semanticDecision: ClarificationDecisionEvidence,
    conflictDetected: boolean
  ): ClarificationDecisionEvidence {
    if (!conflictDetected) {
      if (ruleDecision.confidenceLevel === "low" && semanticDecision.confidenceLevel !== "low") {
        return semanticDecision;
      }
      return ruleDecision;
    }

    const ruleScore = this.scoreConfidence(ruleDecision.confidenceLevel);
    const semanticScore = this.scoreConfidence(semanticDecision.confidenceLevel);

    if (semanticScore > ruleScore) {
      return semanticDecision;
    }
    if (ruleScore > semanticScore) {
      return ruleDecision;
    }

    if (ruleDecision.decision === "clarify" || semanticDecision.decision === "clarify") {
      return {
        ...semanticDecision,
        decision: "clarify",
        confidenceLevel: "medium",
        question:
          semanticDecision.question?.trim() ||
          ruleDecision.question?.trim() ||
          "请补充关键分析信息后继续。",
        reason:
          semanticDecision.reason?.trim() ||
          ruleDecision.reason?.trim() ||
          "规则与语义信号冲突，保守进入澄清流程。"
      };
    }

    return ruleDecision;
  }

  private normalizeConfidenceLevel(
    confidenceLevel: ClarificationDecisionEvidence["confidenceLevel"]
  ): "high" | "medium" | "low" {
    if (confidenceLevel === "high" || confidenceLevel === "medium" || confidenceLevel === "low") {
      return confidenceLevel;
    }
    return "medium";
  }

  private normalizeSlots(
    slots: ClarificationDecisionEvidence["missingCriticalSlots"]
  ): ClarificationSlotKey[] {
    if (!Array.isArray(slots)) {
      return [];
    }
    return slots.filter((slot): slot is ClarificationSlotKey => {
      return typeof slot === "string" && slot.trim().length > 0;
    });
  }

  private scoreConfidence(confidence: ClarificationDecisionEvidence["confidenceLevel"]): number {
    if (confidence === "high") {
      return 3;
    }
    if (confidence === "medium") {
      return 2;
    }
    if (confidence === "low") {
      return 1;
    }
    return 2;
  }

  private mapFallbackReason(
    semanticEvaluation: ClarificationSemanticEvaluationResult
  ): "timeout" | "error" | "invalid_payload" {
    if (semanticEvaluation.status === "timeout") {
      return "timeout";
    }
    if (semanticEvaluation.status === "invalid") {
      return "invalid_payload";
    }
    return "error";
  }

  private buildStrictModeReasons(decision: ClarificationDecisionEvidence): string[] {
    const reasons: string[] = [];
    if (decision.decision === "clarify") {
      reasons.push("clarification_decision_clarify");
    }
    if (decision.confidenceLevel === "low") {
      reasons.push("clarification_low_confidence");
    }
    if (decision.conflictDetected) {
      reasons.push("clarification_rule_semantic_conflict");
    }
    return unique(reasons);
  }

  private toStageRiskTags(
    stage: "rule" | "semantic",
    reasonCodes: string[] | undefined
  ): string[] {
    return (reasonCodes ?? []).map((reasonCode) => `${stage}:${reasonCode}`);
  }
}

const unique = (values: string[]): string[] => {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
};
