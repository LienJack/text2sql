import { Injectable } from "@nestjs/common";
import type { ClarificationDecisionEvidence } from "@text2sql/shared-types";
import {
  ClarificationFusionPolicy,
  mapRuleDecisionToEvidence
} from "./clarification-fusion.policy";
import { ClarificationSemanticEvaluatorService } from "./clarification-semantic-evaluator.service";
import type { RetrievedKnowledge } from "./retrieve-knowledge.node";
import { decideSlotFilling } from "./slot-filling-context";

export interface IntentUncertaintySignal {
  level: "low" | "medium" | "high";
  needsStrictSemanticPath: boolean;
  reasonCodes: string[];
}

export interface IntentPlan {
  status: "ready" | "degraded";
  intent: "aggregate" | "detail" | "compare" | "unknown";
  constraints: string[];
  summary: string;
  uncertaintySignal?: IntentUncertaintySignal;
  clarificationDecision?: ClarificationDecisionEvidence;
  riskTags?: string[];
  planningWarnings?: string[];
}

@Injectable()
export class BuildIntentPlanNode {
  constructor(
    private readonly semanticEvaluator: ClarificationSemanticEvaluatorService,
    private readonly clarificationFusionPolicy: ClarificationFusionPolicy
  ) {}

  async run(
    question: string,
    knowledge: RetrievedKnowledge,
    clarificationDecision?: ClarificationDecisionEvidence
  ): Promise<IntentPlan> {
    const normalizedQuestion = question.toLowerCase();
    const selectedContextCount = knowledge.retrievalBundle?.selected_context?.length ?? 0;
    const pinnedConstraint =
      knowledge.pinning?.enabled && knowledge.pinning.status === "applied"
        ? ["require_pinned_table_alignment"]
        : [];

    const ruleDecision = this.resolveRuleDecision(question, clarificationDecision);
    const semanticEvaluation = this.clarificationFusionPolicy.shouldArbitrate(ruleDecision)
      ? await this.semanticEvaluator.evaluate({
          question,
          ruleDecision
        })
      : undefined;
    const fusion = this.clarificationFusionPolicy.fuse({
      ruleDecision,
      semanticEvaluation
    });

    const bypassedBusinessSemantics = this.isBypassDecision(fusion.decision);
    const uncertaintySignal = this.buildUncertaintySignal({
      fusionDecision: fusion.decision,
      strictModeReasons: fusion.metadata.strictModeReasons,
      knowledgeDegraded: knowledge.status === "degraded",
      bypassedBusinessSemantics
    });

    const planningWarnings = this.buildPlanningWarnings({
      fusionDecision: fusion.decision,
      fallbackApplied: fusion.metadata.fallbackApplied,
      fallbackReason: fusion.metadata.fallbackReason,
      strictModeReasons: fusion.metadata.strictModeReasons,
      knowledgeSummary: knowledge.summary,
      knowledgeStatus: knowledge.status
    });

    if (knowledge.status === "degraded") {
      return {
        status: "degraded",
        intent: "unknown",
        constraints: [
          ...(selectedContextCount > 0 ? ["fallback_with_partial_context"] : []),
          ...pinnedConstraint,
          ...(bypassedBusinessSemantics ? ["skip_business_semantic_assertions"] : [])
        ],
        summary: "检索上下文不可用，意图规划降级。",
        uncertaintySignal,
        clarificationDecision: fusion.decision,
        riskTags: this.unique([
          "intent:knowledge_degraded",
          ...fusion.metadata.stageRiskTags.rule.map((tag) => `intent:${tag}`),
          ...fusion.metadata.stageRiskTags.semantic.map((tag) => `intent:${tag}`),
          ...fusion.metadata.stageRiskTags.fusion.map((tag) => `intent:${tag}`)
        ]),
        planningWarnings
      };
    }

    const baseConstraints: string[] = [
      ...(selectedContextCount > 0 ? ["must_use_selected_context"] : []),
      ...pinnedConstraint,
      ...(bypassedBusinessSemantics ? ["skip_business_semantic_assertions"] : [])
    ];

    if (/统计|总数|分布|汇总/.test(normalizedQuestion)) {
      return {
        status: "ready",
        intent: "aggregate",
        constraints: ["prefer_group_by", ...baseConstraints],
        summary: "意图识别为聚合统计。",
        uncertaintySignal,
        clarificationDecision: fusion.decision,
        riskTags: this.resolveRiskTags(fusion),
        planningWarnings
      };
    }
    if (/对比|比较|同比|环比/.test(normalizedQuestion)) {
      return {
        status: "ready",
        intent: "compare",
        constraints: ["require_two_dimensions", ...baseConstraints],
        summary: "意图识别为对比分析。",
        uncertaintySignal,
        clarificationDecision: fusion.decision,
        riskTags: this.resolveRiskTags(fusion),
        planningWarnings
      };
    }

    return {
      status: "ready",
      intent: "detail",
      constraints: baseConstraints,
      summary: "意图识别为明细查询。",
      uncertaintySignal,
      clarificationDecision: fusion.decision,
      riskTags: this.resolveRiskTags(fusion),
      planningWarnings
    };
  }

  private resolveRuleDecision(
    question: string,
    clarificationDecision?: ClarificationDecisionEvidence
  ): ClarificationDecisionEvidence {
    if (clarificationDecision?.decision) {
      return {
        ...clarificationDecision,
        triggerPath: clarificationDecision.triggerPath ?? "rule",
        confidenceLevel: clarificationDecision.confidenceLevel ?? "medium",
        missingCriticalSlots: clarificationDecision.missingCriticalSlots ?? [],
        conflictDetected: Boolean(clarificationDecision.conflictDetected),
        reasonCodes: this.unique(clarificationDecision.reasonCodes ?? [])
      };
    }
    return mapRuleDecisionToEvidence(decideSlotFilling(question));
  }

  private buildUncertaintySignal(input: {
    fusionDecision: ClarificationDecisionEvidence;
    strictModeReasons: string[];
    knowledgeDegraded: boolean;
    bypassedBusinessSemantics: boolean;
  }): IntentUncertaintySignal {
    if (input.bypassedBusinessSemantics) {
      return {
        level: "low",
        needsStrictSemanticPath: false,
        reasonCodes: this.unique([
          ...(input.fusionDecision.reasonCodes ?? []),
          "intent_bypass_business_semantics"
        ])
      };
    }

    const confidence = input.fusionDecision.confidenceLevel ?? "medium";
    const level: "low" | "medium" | "high" =
      input.knowledgeDegraded || input.fusionDecision.decision === "clarify"
        ? "high"
        : confidence === "low" || input.fusionDecision.conflictDetected
          ? "medium"
          : "low";

    return {
      level,
      needsStrictSemanticPath:
        level !== "low" || input.strictModeReasons.length > 0 || input.knowledgeDegraded,
      reasonCodes: this.unique([
        ...(input.fusionDecision.reasonCodes ?? []),
        ...input.strictModeReasons,
        input.knowledgeDegraded ? "intent_knowledge_degraded" : "intent_knowledge_ready"
      ])
    };
  }

  private resolveRiskTags(fusion: {
    metadata: {
      stageRiskTags: {
        rule: string[];
        semantic: string[];
        fusion: string[];
      };
    };
  }): string[] {
    return this.unique([
      ...fusion.metadata.stageRiskTags.rule.map((tag) => `intent:${tag}`),
      ...fusion.metadata.stageRiskTags.semantic.map((tag) => `intent:${tag}`),
      ...fusion.metadata.stageRiskTags.fusion.map((tag) => `intent:${tag}`)
    ]);
  }

  private buildPlanningWarnings(input: {
    fusionDecision: ClarificationDecisionEvidence;
    fallbackApplied: boolean;
    fallbackReason?: "disabled" | "kill-switch" | "timeout" | "error" | "invalid_payload";
    strictModeReasons: string[];
    knowledgeSummary: string;
    knowledgeStatus: RetrievedKnowledge["status"];
  }): string[] {
    const warnings: string[] = [];
    if (input.fallbackApplied) {
      warnings.push(
        `clarification fusion fallback applied (${input.fallbackReason ?? "unknown"})`
      );
    }
    if (input.strictModeReasons.length > 0) {
      warnings.push(`strict semantic path required (${input.strictModeReasons.join(", ")})`);
    }
    if (input.fusionDecision.conflictDetected) {
      warnings.push("rule and semantic decisions conflicted during arbitration");
    }
    if (input.knowledgeStatus === "degraded") {
      warnings.push(input.knowledgeSummary);
    }
    return this.unique(warnings);
  }

  private isBypassDecision(decision: ClarificationDecisionEvidence): boolean {
    if (decision.bypassed || decision.decisionSource === "metadata-intent" || decision.decisionSource === "sql-write-intent") {
      return true;
    }
    const reasonCodes = decision.reasonCodes ?? [];
    return reasonCodes.some((reasonCode) => {
      return (
        reasonCode === "bypass_metadata_intent" ||
        reasonCode === "bypass_sql_write_intent" ||
        reasonCode === "rule_source_metadata-intent" ||
        reasonCode === "rule_source_sql-write-intent"
      );
    });
  }

  private unique(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  }
}
