"use client";

import { Badge } from "@/components/ui/badge";
import { StateBlock } from "@/components/ui/state-block";
import type { RagFoundationSnapshot } from "@/lib/settings-api-client";
import { cn } from "@/lib/utils";

type StatusTone = {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
};

interface RagFoundationStatusCardProps {
  foundation: RagFoundationSnapshot | null;
  loading?: boolean;
  error?: string;
  compact?: boolean;
  className?: string;
}

function resolveActivationStatus(foundation: RagFoundationSnapshot): StatusTone {
  if (foundation.activeIndexSummary.total > 0) {
    return { label: "激活成功", variant: "default" };
  }
  if (foundation.observedBuilds === 0) {
    return { label: "未开始构建", variant: "secondary" };
  }
  if (foundation.buildSuccessCount === 0 && foundation.buildFailureCount === 0) {
    return { label: "构建中", variant: "outline" };
  }
  if (foundation.buildSuccessCount === 0 && foundation.buildFailureCount > 0) {
    return { label: "激活失败", variant: "destructive" };
  }
  return { label: "未激活", variant: "outline" };
}

function resolveBuildStatus(foundation: RagFoundationSnapshot): StatusTone {
  if (foundation.observedBuilds === 0) {
    return { label: "暂无构建记录", variant: "secondary" };
  }
  if (foundation.buildSuccessCount === 0 && foundation.buildFailureCount === 0) {
    return { label: "构建中", variant: "outline" };
  }
  if (foundation.buildFailureCount === 0) {
    return { label: "构建成功", variant: "default" };
  }
  if (foundation.buildSuccessCount === 0) {
    return { label: "构建失败", variant: "destructive" };
  }
  return { label: "部分成功", variant: "outline" };
}

function resolveRollbackStatus(foundation: RagFoundationSnapshot): StatusTone {
  const rollbackReasonCount = Object.entries(foundation.failureReasons).reduce(
    (count, [reason, value]) =>
      /rollback|rolled_back|revert|fallback/i.test(reason) ? count + value : count,
    0
  );

  if (rollbackReasonCount > 0) {
    return { label: "已回滚", variant: "destructive" };
  }
  if (foundation.buildFailureCount > 0) {
    return { label: "未上报回滚事件", variant: "outline" };
  }
  if (foundation.observedBuilds === 0) {
    return { label: "暂无回滚信息", variant: "secondary" };
  }
  return { label: "未发生回滚", variant: "default" };
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatDateTime(value?: string): string {
  if (!value) {
    return "未上报";
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }
  return new Date(timestamp).toLocaleString("zh-CN", { hour12: false });
}

export function RagFoundationStatusCard({
  foundation,
  loading = false,
  error,
  compact = false,
  className
}: RagFoundationStatusCardProps) {
  const activationStatus = foundation ? resolveActivationStatus(foundation) : null;
  const buildStatus = foundation ? resolveBuildStatus(foundation) : null;
  const rollbackStatus = foundation ? resolveRollbackStatus(foundation) : null;
  const latestActiveIndex = foundation?.activeIndexSummary.items[0];

  return (
    <div className={cn("space-y-2", className)}>
      {loading ? (
        <StateBlock variant="loading">基础状态加载中...</StateBlock>
      ) : null}
      {error ? (
        <StateBlock variant="error">基础状态拉取失败：{error}</StateBlock>
      ) : null}
      {!loading && !error && !foundation ? (
        <StateBlock variant="idle">暂无基础状态数据</StateBlock>
      ) : null}

      {foundation ? (
        <div className="space-y-2 rounded-md border border-[var(--border-default)] bg-[var(--surface-subtle)] p-3 text-xs text-[var(--text-secondary)]">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={activationStatus?.variant}>{activationStatus?.label}</Badge>
            <Badge variant={buildStatus?.variant}>{buildStatus?.label}</Badge>
            <Badge variant={rollbackStatus?.variant}>{rollbackStatus?.label}</Badge>
          </div>

          <div className={cn("grid gap-2", compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2")}>
            <p>
              索引版本：{latestActiveIndex?.indexVersionId ?? "未激活"}
              {latestActiveIndex?.sourceVersion
                ? ` (source=${latestActiveIndex.sourceVersion})`
                : ""}
            </p>
            <p>激活索引数：{foundation.activeIndexSummary.total}</p>
            <p>
              构建结果：{foundation.buildSuccessCount} 成功 /{" "}
              {foundation.buildFailureCount} 失败 / 共 {foundation.observedBuilds}
            </p>
            <p>成功率：{formatPercent(foundation.buildSuccessRate)}</p>
            <p>回滚相关：{rollbackStatus?.label ?? "未上报"}</p>
            <p>最近快照：{formatDateTime(foundation.generatedAt)}</p>
          </div>

          {foundation.degradedReason ? (
            <StateBlock variant="error">降级原因：{foundation.degradedReason}</StateBlock>
          ) : null}
          {latestActiveIndex ? (
            <p>
              最近激活：{latestActiveIndex.datasourceId} ·{" "}
              {formatDateTime(latestActiveIndex.activatedAt)}
            </p>
          ) : (
            <p>当前无活跃索引。</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
