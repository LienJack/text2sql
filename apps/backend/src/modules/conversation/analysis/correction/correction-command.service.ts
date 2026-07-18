import { Injectable } from "@nestjs/common";
import type {
  AnalysisCorrectionImpactV1,
  AnalysisCorrectionV1
} from "@text2sql/shared-types";
import { DomainError } from "../../../../common/domain-error";
import { AnalysisArtifactRepository } from "../../../platform/data/persistence/analysis-artifact.repository";
import {
  sha256Digest,
  stableJson
} from "../../../platform/data/persistence/analysis-ledger.util";
import { AnalysisTaskRepository } from "../../../platform/data/persistence/analysis-task.repository";
import { AnalysisTaskService } from "../application/analysis-task.service";
import { CorrectionImpactService } from "./correction-impact.service";

@Injectable()
export class CorrectionCommandService {
  constructor(
    private readonly tasks: AnalysisTaskService,
    private readonly artifacts: AnalysisArtifactRepository,
    private readonly impacts: CorrectionImpactService,
    private readonly taskRepository: AnalysisTaskRepository
  ) {}

  async correct(input: {
    actor: Express.RequestActor;
    taskId: string;
    targetArtifactRefs: string[];
    replacementArtifactRefs?: string[];
    errorClass: AnalysisCorrectionV1["errorClass"];
    scope: string;
    effectiveAt: string;
    reason: string;
    decisionRef?: string;
    idempotencyKey: string;
  }): Promise<{
    correctionRef: string;
    impactRef: string;
    correction: AnalysisCorrectionV1;
    impact: AnalysisCorrectionImpactV1;
    manifestId: string;
    recomputeRevisionId: string;
    recomputeAttemptId: string;
  }> {
    const model = await this.tasks.get(input.actor, input.taskId);
    const attempt = [...model.attempts]
      .reverse()
      .find((item) => item.revisionId === model.currentRevision.id);
    if (!attempt) {
      throw new DomainError(
        "ANALYSIS_ATTEMPT_REQUIRED",
        "Correction 需要当前 Revision 的 Attempt。",
        409
      );
    }
    const targets = unique(input.targetArtifactRefs);
    const replacements = unique(input.replacementArtifactRefs ?? []);
    const known = new Set(model.artifacts.map((artifact) => artifact.id));
    if (
      targets.length === 0 ||
      [...targets, ...replacements].some((ref) => !known.has(ref)) ||
      !input.reason.trim() ||
      !input.scope.trim()
    ) {
      throw new DomainError(
        "ANALYSIS_CORRECTION_INVALID",
        "Correction target/replacement、scope 或 reason 无效。",
        400
      );
    }
    const correctionId = `correction:${sha256Digest(
      stableJson({
        taskId: input.taskId,
        targets,
        replacements,
        errorClass: input.errorClass,
        effectiveAt: input.effectiveAt,
        idempotencyKey: input.idempotencyKey
      })
    )}`;
    const previous = model.events.find(
      (event) =>
        event.type === "correction.recompute.ready" &&
        event.data.correctionRef === correctionId
    );
    if (previous) {
      const impactRef = String(previous.data.impactRef ?? "");
      const manifestId = String(previous.data.manifestId ?? "");
      const recomputeRevisionId = String(
        previous.data.recomputeRevisionId ?? ""
      );
      const recomputeAttemptId = String(previous.data.recomputeAttemptId ?? "");
      if (
        impactRef &&
        manifestId &&
        recomputeRevisionId &&
        recomputeAttemptId
      ) {
        const correctionArtifact = await this.artifacts.readCommittedPayload(
          input.taskId,
          correctionId
        );
        const impactArtifact = await this.artifacts.readCommittedPayload(
          input.taskId,
          impactRef
        );
        return {
          correctionRef: correctionId,
          impactRef,
          correction: correctionArtifact.payload as unknown as AnalysisCorrectionV1,
          impact: impactArtifact.payload as unknown as AnalysisCorrectionImpactV1,
          manifestId,
          recomputeRevisionId,
          recomputeAttemptId
        };
      }
    }
    const correction: AnalysisCorrectionV1 = {
      version: "analysis-correction.v1",
      correctionId,
      targetArtifactRefs: targets,
      replacementArtifactRefs: replacements,
      errorClass: input.errorClass,
      authority: {
        actorId: input.actor.id,
        principalDigest: this.tasks.principalDigest(input.actor),
        ...(input.decisionRef ? { decisionRef: input.decisionRef } : {})
      },
      scope: input.scope.trim(),
      effectiveAt: new Date(input.effectiveAt).toISOString(),
      reason: input.reason.trim()
    };
    const correctionArtifact = await this.artifacts.commitArtifact({
      artifactId: correctionId,
      taskId: input.taskId,
      revisionId: model.currentRevision.id,
      attemptId: attempt.id,
      authorityEpoch: model.task.authorityEpoch,
      artifactType: "analysis.correction",
      schemaVersion: correction.version,
      classification: "workspace",
      visibility: "user",
      completeness: "complete",
      links: [
        ...targets.map((targetArtifactId) => ({
          targetArtifactId,
          relationType: "invalidates" as const
        })),
        ...replacements.map((targetArtifactId) => ({
          targetArtifactId,
          relationType: "derived_from" as const
        }))
      ],
      payload: correction as unknown as Record<string, unknown>,
      receipt: {
        receiptType: "analysis.correction-authority.v1",
        decision: "accepted",
        reasonCodes: ["correction_authority_bound"],
        principalDigest: this.tasks.principalDigest(input.actor),
        policyRefs: {
          authPolicyVersion: input.actor.principal?.authPolicyVersion ?? "missing",
          ...(input.decisionRef ? { decisionRef: input.decisionRef } : {})
        }
      }
    });
    const impact = await this.impacts.apply({
      taskId: input.taskId,
      revisionId: model.currentRevision.id,
      attemptId: attempt.id,
      workspaceId: model.task.workspaceId,
      correctionRef: correctionArtifact.id,
      targetArtifactRefs: targets,
      actorId: input.actor.id
    });
    const impactRef = `correction-impact:${impact.impactDigest}`;
    await this.artifacts.commitArtifact({
      artifactId: impactRef,
      taskId: input.taskId,
      revisionId: model.currentRevision.id,
      attemptId: attempt.id,
      authorityEpoch: model.task.authorityEpoch,
      artifactType: "analysis.correction_impact",
      schemaVersion: impact.version,
      classification: "workspace",
      visibility: "user",
      completeness: "complete",
      links: [correctionArtifact.id, ...impact.impactedArtifactRefs].map(
        (targetArtifactId) => ({
          targetArtifactId,
          relationType: "derived_from" as const
        })
      ),
      payload: impact as unknown as Record<string, unknown>
    });
    const manifest = await this.artifacts.sealManifest({
      manifestId: `correction-manifest:${impact.impactDigest}`,
      taskId: input.taskId,
      revisionId: model.currentRevision.id,
      attemptId: attempt.id,
      authorityEpoch: model.task.authorityEpoch,
      manifestType: "analysis.correction-impact",
      schemaVersion: "analysis-correction-impact-manifest.v1",
      status: "HOLD",
      artifactRefs: [
        correctionArtifact.id,
        impactRef,
        ...impact.impactedArtifactRefs
      ],
      receiptRefs: [],
      limitations: ["current_revision_requires_recomputation"]
    });
    const revised = await this.tasks.revise({
      actor: input.actor,
      taskId: input.taskId,
      expectedTaskVersion: model.task.version,
      goalContract: model.currentRevision.goalContract
    });
    const recomputeAttempt = await this.taskRepository.createAttempt({
      taskId: input.taskId,
      revisionId: revised.currentRevision.id,
      idempotencyKey: `correction-recompute:${correctionArtifact.id}`
    });
    await this.taskRepository.appendEvent({
      taskId: input.taskId,
      revisionId: revised.currentRevision.id,
      attemptId: recomputeAttempt.id,
      idempotencyKey: `correction-recompute-ready:${correctionArtifact.id}`,
      eventType: "correction.recompute.ready",
      data: {
        correctionRef: correctionArtifact.id,
        supersededRevisionId: model.currentRevision.id,
        recomputeRevisionId: revised.currentRevision.id,
        recomputeAttemptId: recomputeAttempt.id,
        impactRef,
        manifestId: manifest.id
      }
    });
    return {
      correctionRef: correctionArtifact.id,
      impactRef,
      correction,
      impact,
      manifestId: manifest.id,
      recomputeRevisionId: revised.currentRevision.id,
      recomputeAttemptId: recomputeAttempt.id
    };
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()).map((value) => value.trim()))].sort();
}
