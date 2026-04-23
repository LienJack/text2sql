"use client";

import { Button } from "@/components/ui/button";
import { StateBlock } from "@/components/ui/state-block";

export type ModelingDeployPrecheckResult = {
  pass: boolean;
  riskLevel: "low" | "medium" | "high";
  blockingReasons: string[];
  draftRevision: number;
  activeRevision?: number;
  dryRun: {
    pass: boolean;
    executedCount: number;
    failedSamples: Array<{ sql: string; reason: string }>;
  };
  schemaChange: {
    highRiskStatus: "low" | "high";
    unresolvedHighRiskCount: number;
    unresolvedSchemaChangeIds: string[];
  };
};

const BLOCKING_REASON_GUIDANCE: Record<string, string> = {
  unresolved_schema_changes: "先在 Schema Change 面板处理残留变更，再重新执行 precheck。",
  policy_version_conflict: "policyVersion 已变化，请刷新最新快照并基于新版本重试。",
  draft_revision_not_found: "当前 draft revision 不存在，请先重新保存 Modeling Draft。",
  table_permissions_mismatch: "表权限和当前建模范围不一致，请同步治理配置后重试。",
  dry_run_failed: "dry-run 执行失败，请先修复失败 SQL 样本。",
  revision_already_active: "当前 draft 已经是 active revision，无需重复激活。",
  duplicate_relationship_edges_detected: "检测到重复 relationship edge，请先清理重复关系。",
  low_confidence_relationship_edges_detected:
    "存在低置信度 relationship edge，请确认关系质量后再部署。"
};

function resolveBlockingReasonGuidance(reason: string): string {
  return BLOCKING_REASON_GUIDANCE[reason] ?? "请根据阻断原因检查建模与治理状态后重试。";
}

export function ModelingDeployPanel(props: {
  busy?: boolean;
  hasUndeployedChanges: boolean;
  precheck?: ModelingDeployPrecheckResult | null;
  onPrecheck: () => Promise<void> | void;
  onDeploy: () => Promise<void> | void;
}) {
  const { busy, hasUndeployedChanges, precheck, onPrecheck, onDeploy } = props;
  const blocked = Boolean(precheck && !precheck.pass);
  return (
    <section className="space-y-3 rounded-lg border border-[var(--border-default)] bg-white/90 p-4">
      <div>
        <p className="text-sm font-semibold text-[var(--text-primary)]">Deploy</p>
        <p className="text-xs text-[var(--text-secondary)]">
          统一执行 precheck + dry-run + activate。
        </p>
      </div>

      {!hasUndeployedChanges ? (
        <StateBlock variant="idle">当前无 undeployed revision，无需 deploy。</StateBlock>
      ) : null}

      {precheck ? (
        <div className="rounded-md border border-[var(--border-default)] bg-white p-3 text-xs text-[var(--text-secondary)]">
          <p>
            Draft {precheck.draftRevision} / Active {precheck.activeRevision ?? "-"} / Risk{" "}
            {precheck.riskLevel}
          </p>
          <p className="mt-1">Dry-run: {precheck.dryRun.pass ? "pass" : "failed"}</p>
          <p className="mt-1">Dry-run Executed: {precheck.dryRun.executedCount}</p>
          <p className="mt-1">
            Schema Change Risk: {precheck.schemaChange.highRiskStatus} / Unresolved{" "}
            {precheck.schemaChange.unresolvedHighRiskCount}
          </p>
          {precheck.schemaChange.unresolvedSchemaChangeIds.length > 0 ? (
            <ul className="mt-2 list-disc pl-4">
              {precheck.schemaChange.unresolvedSchemaChangeIds.map((item) => (
                <li key={item}>schemaChangeId: {item}</li>
              ))}
            </ul>
          ) : null}
          {precheck.blockingReasons.length > 0 ? (
            <ul className="mt-2 list-disc pl-4">
              {precheck.blockingReasons.map((item) => (
                <li key={item}>
                  <span className="font-medium text-[var(--text-primary)]">
                    {resolveBlockingReasonGuidance(item)}
                  </span>
                  <span className="ml-1">({item})</span>
                </li>
              ))}
            </ul>
          ) : null}
          {precheck.dryRun.failedSamples.length > 0 ? (
            <div className="mt-2 space-y-1">
              <p className="font-medium text-[var(--text-primary)]">Dry-run Failed Samples</p>
              <ul className="list-disc pl-4">
                {precheck.dryRun.failedSamples.map((item, index) => (
                  <li key={`${item.sql}-${index}`}>
                    <span className="text-[var(--text-primary)]">{item.reason}</span>
                    <span className="ml-1">{item.sql}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy || !hasUndeployedChanges} onClick={() => void onPrecheck()}>
          Precheck
        </Button>
        <Button size="sm" disabled={busy || !hasUndeployedChanges || blocked} onClick={() => void onDeploy()}>
          Activate Revision
        </Button>
      </div>
    </section>
  );
}
