"use client";

import { useEffect, useMemo, useState } from "react";
import type { DeliveryContract } from "@text2sql/shared-types";
import { Badge } from "@/components/ui/badge";
import { RagDeliverySection } from "@/components/chat/rag-delivery-section";
import { StateBlock } from "@/components/ui/state-block";

interface RagDeliveryPanelProps {
  delivery?: DeliveryContract;
  runId?: string;
}

type SelectedContextState = "happy" | "nil" | "empty" | "error";
type RagDeliverySectionId = "answer" | "evidence" | "artifact";
type RagDeliverySectionSeverity = "critical" | "warning" | "normal";

const sectionManualStateByRun = new Map<
  string,
  Partial<Record<RagDeliverySectionId, boolean>>
>();
const FAIL_CLOSED_HINTS = [
  "fail_closed",
  "fail-closed",
  "sandbox",
  "policy_denied",
  "permission_denied",
  "unauthorized",
  "guardrail",
  "security"
];

function sectionSeverityScore(severity: RagDeliverySectionSeverity): number {
  if (severity === "critical") {
    return 3;
  }
  if (severity === "warning") {
    return 2;
  }
  return 1;
}

function resolveAutoExpandedSection(
  severities: Record<RagDeliverySectionId, RagDeliverySectionSeverity>
): RagDeliverySectionId {
  const evidenceScore = sectionSeverityScore(severities.evidence);
  const artifactScore = sectionSeverityScore(severities.artifact);
  const answerScore = sectionSeverityScore(severities.answer);
  const highestScore = Math.max(evidenceScore, artifactScore, answerScore);

  if (highestScore === 1) {
    return "answer";
  }
  if (evidenceScore === highestScore) {
    return "evidence";
  }
  if (artifactScore === highestScore) {
    return "artifact";
  }
  return "answer";
}

function buildExpandedSections(
  autoExpanded: RagDeliverySectionId,
  manual: Partial<Record<RagDeliverySectionId, boolean>>
): Record<RagDeliverySectionId, boolean> {
  return {
    answer: manual.answer ?? autoExpanded === "answer",
    evidence: manual.evidence ?? autoExpanded === "evidence",
    artifact: manual.artifact ?? autoExpanded === "artifact"
  };
}

function includesFailClosedHint(value: string): boolean {
  const normalized = value.toLowerCase();
  return FAIL_CLOSED_HINTS.some((keyword) => normalized.includes(keyword));
}

function normalizeAlerts(values: string[]): string[] {
  return Array.from(new Set(values.filter((item) => item.trim().length > 0)));
}

function resolveFailClosedAlerts(delivery?: DeliveryContract): string[] {
  if (!delivery) {
    return [];
  }
  const evidence = delivery.evidence;
  const artifact = delivery.artifact;
  const alerts: string[] = [];

  for (const reason of evidence?.degradeReasons ?? []) {
    if (includesFailClosedHint(reason)) {
      alerts.push(`degrade_reason:${reason}`);
    }
  }
  for (const tag of evidence?.riskTags ?? []) {
    if (includesFailClosedHint(tag)) {
      alerts.push(`risk_tag:${tag}`);
    }
  }
  if (artifact?.hasError) {
    alerts.push("artifact:error");
  }

  return normalizeAlerts(alerts);
}

function renderSelectedContextState(
  delivery: DeliveryContract
): { state: SelectedContextState; node: JSX.Element } {
  const evidence = delivery.evidence;
  if (!evidence) {
    return {
      state: "nil",
      node: <StateBlock variant="idle">暂无证据（字段缺失）。</StateBlock>
    };
  }

  const selectedContext = evidence.selectedContext;
  if (!selectedContext) {
    if ((evidence.degradeReasons?.length ?? 0) > 0) {
      return {
        state: "error",
        node: (
          <StateBlock variant="error">
            检索链路降级：{evidence.degradeReasons?.join("，")}
          </StateBlock>
        )
      };
    }
    return {
      state: "nil",
      node: <StateBlock variant="idle">上下文缺失（回退执行）。</StateBlock>
    };
  }
  if (selectedContext.count <= 0) {
    return {
      state: "empty",
      node: <StateBlock variant="idle">未检索到可用上下文。</StateBlock>
    };
  }
  return {
    state: "happy",
    node: (
      <div className="space-y-1">
        <p className="text-xs text-[var(--text-secondary)]">
          已选上下文 {selectedContext.count} 条
        </p>
        {(selectedContext.snippets ?? []).length > 0 ? (
          <ul className="space-y-1 text-xs text-[var(--text-secondary)]">
            {(selectedContext.snippets ?? []).map((item, index) => (
              <li
                key={`${item}-${index}`}
                className="rounded border border-[var(--border-default)] bg-[var(--surface-subtle)] px-2 py-1"
              >
                {item}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    )
  };
}

export function RagDeliveryPanel({ delivery, runId }: RagDeliveryPanelProps) {
  const evidence = delivery?.evidence;
  const artifact = delivery?.artifact;
  const runLifecycleKey = runId?.trim() || evidence?.runId?.trim() || "__unknown-run__";
  const semanticVersionText = evidence?.semanticVersion ?? "版本不可用（字段缺失）";
  const semanticLockStatusText =
    evidence?.semanticLockStatus ?? "锁状态不可用（字段缺失）";
  const semanticDegradeReasonText =
    evidence?.semanticDegradeReason ?? "未触发（字段缺失或未降级）";
  const semanticDegradeTriggered = Boolean(evidence?.semanticDegradeReason);
  const skillContextSummaryText = evidence?.skillContextSummary
    ? `skills=${evidence.skillContextSummary.skillCount}, context=${evidence.skillContextSummary.contextCount}${
        evidence.skillContextSummary.degradeReason
          ? `, degradeReason=${evidence.skillContextSummary.degradeReason}`
          : ", degradeReason=未上报"
      }`
    : "skills=0（字段缺失）, context=0（字段缺失）, degradeReason=不可用（字段缺失）";
  const hasDegrade =
    (evidence?.retrievalStatus === "degraded") ||
    (evidence?.degradeReasons?.length ?? 0) > 0 ||
    Boolean(evidence?.semanticDegradeReason);
  const failClosedAlerts = resolveFailClosedAlerts(delivery);
  const hasFailClosedAlert = failClosedAlerts.length > 0;
  const selectedContextState = delivery
    ? renderSelectedContextState(delivery)
    : {
        state: "nil" as const,
        node: <StateBlock variant="idle">暂无证据（字段缺失）。</StateBlock>
      };
  const resolvedRetrievalStatus =
    evidence?.retrievalStatus ?? (hasDegrade ? "degraded" : "ready");
  const noArtifactOutput = Boolean(
    artifact && !artifact.hasError && artifact.rowCount === 0
  );
  const sectionSeverities = useMemo<
    Record<RagDeliverySectionId, RagDeliverySectionSeverity>
  >(
    () => ({
      answer: "normal",
      evidence: hasFailClosedAlert
        ? "critical"
        : hasDegrade || (evidence?.riskTags?.length ?? 0) > 0
          ? "warning"
          : "normal",
      artifact: hasFailClosedAlert
        ? "critical"
        : artifact?.hasError
          ? "warning"
          : "normal"
    }),
    [artifact?.hasError, evidence?.riskTags, hasDegrade, hasFailClosedAlert]
  );
  const autoExpandedSection = useMemo(
    () => resolveAutoExpandedSection(sectionSeverities),
    [sectionSeverities]
  );
  const [expandedSections, setExpandedSections] = useState<
    Record<RagDeliverySectionId, boolean>
  >(() => {
    const manual = sectionManualStateByRun.get(runLifecycleKey) ?? {};
    return buildExpandedSections(autoExpandedSection, manual);
  });

  useEffect(() => {
    const manual = sectionManualStateByRun.get(runLifecycleKey) ?? {};
    setExpandedSections(buildExpandedSections(autoExpandedSection, manual));
  }, [autoExpandedSection, runLifecycleKey]);

  if (!delivery) {
    return <StateBlock variant="idle">暂无 RAG 证据（字段缺失）。</StateBlock>;
  }

  const handleOpenChange = (section: RagDeliverySectionId, nextOpen: boolean) => {
    setExpandedSections((previous) => ({
      ...previous,
      [section]: nextOpen
    }));
    const previousManual = sectionManualStateByRun.get(runLifecycleKey) ?? {};
    sectionManualStateByRun.set(runLifecycleKey, {
      ...previousManual,
      [section]: nextOpen
    });
  };

  return (
    <div className="space-y-3">
      {hasFailClosedAlert ? (
        <StateBlock variant="error">
          fail-closed 安全提示：检测到受控降级（
          {failClosedAlerts.join("，")}），已保留主回答并限制风险路径。
        </StateBlock>
      ) : null}

      <RagDeliverySection
        id="answer"
        title="Answer"
        open={expandedSections.answer}
        severity={sectionSeverities.answer}
        summary={`${hasDegrade ? "degraded" : "ready"} · ${delivery.answer.provider}${
          delivery.answer.model ? ` / ${delivery.answer.model}` : ""
        }`}
        onOpenChange={(nextOpen) => handleOpenChange("answer", nextOpen)}
      >
        <div className="space-y-2">
          <p className="text-sm text-[var(--text-primary)]">{delivery.answer.text}</p>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant={hasDegrade ? "destructive" : "default"}>
              {hasDegrade ? "degraded" : "ready"}
            </Badge>
            <span className="text-[var(--text-tertiary)]">
              {delivery.answer.provider}
              {delivery.answer.model ? ` / ${delivery.answer.model}` : ""}
            </span>
          </div>
        </div>
      </RagDeliverySection>

      <RagDeliverySection
        id="evidence"
        title="Evidence"
        open={expandedSections.evidence}
        severity={sectionSeverities.evidence}
        summary={`runId=${evidence?.runId ?? "unknown"} · retrieval=${resolvedRetrievalStatus}`}
        onOpenChange={(nextOpen) => handleOpenChange("evidence", nextOpen)}
      >
        <div className="space-y-2">
          <div className="space-y-1 text-xs text-[var(--text-secondary)]">
            <p>运行 ID：{evidence?.runId ?? "未知"}</p>
            <p>检索状态：{resolvedRetrievalStatus}</p>
            <p>selected_context 状态：{selectedContextState.state}</p>
          </div>
          {selectedContextState.node}
          {(evidence?.degradeReasons?.length ?? 0) > 0 ? (
            <p className="text-xs text-[var(--text-secondary)]">
              degrade_reason：{evidence?.degradeReasons?.join("，")}
            </p>
          ) : null}
          {evidence?.riskTags && evidence.riskTags.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {evidence.riskTags.map((tag) => (
                <Badge key={tag} variant="outline">
                  {tag}
                </Badge>
              ))}
            </div>
          ) : (
            <StateBlock variant="idle">未上报风险标签。</StateBlock>
          )}
          <p className="text-xs text-[var(--text-tertiary)]">
            治理细节（回放完整性/记忆反馈）请在设置页查看。
          </p>
          <div className="space-y-1 text-xs text-[var(--text-secondary)]">
            <p>语义版本：{semanticVersionText}</p>
            <p>语义锁状态：{semanticLockStatusText}</p>
            <p>语义降级原因：{semanticDegradeReasonText}</p>
            <StateBlock variant={semanticDegradeTriggered ? "error" : "idle"}>
              语义降级标识：
              {semanticDegradeTriggered ? "已触发（不阻断主回答）" : "未触发"}
            </StateBlock>
            <p>技能上下文（只读）：{skillContextSummaryText}</p>
          </div>
          {evidence?.retrievalLogs && evidence.retrievalLogs.length > 0 ? (
            <ul className="space-y-1 text-xs text-[var(--text-secondary)]">
              {evidence.retrievalLogs.slice(0, 3).map((log) => (
                <li
                  key={`${log.replayKey}-${log.createdAt}`}
                  className="rounded border border-[var(--border-default)] bg-[var(--surface-panel)] px-2 py-1"
                >
                  {log.stage} · {log.replayKey}
                  {log.indexVersionId ? ` · index=${log.indexVersionId}` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <StateBlock variant="idle">暂无证据命中。</StateBlock>
          )}
        </div>
      </RagDeliverySection>

      <RagDeliverySection
        id="artifact"
        title="Artifact"
        open={expandedSections.artifact}
        severity={sectionSeverities.artifact}
        summary={
          !artifact
            ? "字段缺失"
            : noArtifactOutput
              ? "无产物"
              : `rowCount=${artifact.rowCount} · hasError=${artifact.hasError ? "true" : "false"}`
        }
        onOpenChange={(nextOpen) => handleOpenChange("artifact", nextOpen)}
      >
        {!artifact ? (
          <StateBlock variant="idle">Artifact 字段缺失（兼容空态）。</StateBlock>
        ) : artifact.hasError ? (
          <div className="space-y-2">
            <StateBlock variant="error">
              Artifact 生成失败或被安全策略 fail-closed 限制。
            </StateBlock>
            <p className="text-xs text-[var(--text-secondary)]">
              rowCount: {artifact.rowCount}
            </p>
            {artifact.columns?.length ? (
              <p className="text-xs text-[var(--text-secondary)]">
                columns: {artifact.columns.join(", ")}
              </p>
            ) : null}
          </div>
        ) : noArtifactOutput ? (
          <StateBlock variant="idle">本次无产物（执行结果为空）。</StateBlock>
        ) : (
          <div className="space-y-1 text-xs text-[var(--text-secondary)]">
            <p>rowCount: {artifact.rowCount}</p>
            <p>hasError: false</p>
            {artifact.columns?.length ? <p>columns: {artifact.columns.join(", ")}</p> : null}
          </div>
        )}
      </RagDeliverySection>
    </div>
  );
}
