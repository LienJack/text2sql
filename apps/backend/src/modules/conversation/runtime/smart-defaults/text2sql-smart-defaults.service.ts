import { Injectable } from "@nestjs/common";
import type {
  PromptTemplateTraceEvidence,
  Text2SqlV2SmartDefaultsEvidenceV1
} from "@text2sql/shared-types";
import {
  TEXT2SQL_SMART_DEFAULTS_EVIDENCE,
  TEXT2SQL_SMART_DEFAULTS_RULES
} from "./text2sql-smart-defaults.bundle";

@Injectable()
export class Text2SqlSmartDefaultsService {
  resolve(input?: {
    promptTemplate?: PromptTemplateTraceEvidence;
    fallbackReason?: string;
  }): {
    evidence: Text2SqlV2SmartDefaultsEvidenceV1;
    promptBlock: string;
  } {
    const evidence: Text2SqlV2SmartDefaultsEvidenceV1 = {
      ...TEXT2SQL_SMART_DEFAULTS_EVIDENCE,
      status: input?.fallbackReason ? "fallback" : "applied",
      ...(input?.fallbackReason ? { fallbackReason: input.fallbackReason } : {}),
      ...(input?.promptTemplate
        ? {
            templateOverlay: {
              applied: true,
              templateId: input.promptTemplate.templateId,
              version: input.promptTemplate.version
            }
          }
        : {})
    };

    return {
      evidence,
      promptBlock: [
        `Text2SQL Smart Defaults ${evidence.bundleId}@${evidence.version}:`,
        ...TEXT2SQL_SMART_DEFAULTS_RULES.map((rule) => `${rule.id}: ${rule.text}`)
      ].join(" ")
    };
  }
}
