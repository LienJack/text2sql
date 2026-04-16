"use client";

import type { ModelCatalogItem, ProviderConfig } from "@text2sql/shared-types";
import {
  ChevronDown,
  CircleCheckBig,
  Gauge,
  HeartPulse,
  PackageCheck,
  Radio
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "@/components/ui/collapsible";
import { StateBlock } from "@/components/ui/state-block";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface ModelCatalogTableProps {
  actorRole: "admin" | "user";
  providers: ProviderConfig[];
  models: ModelCatalogItem[];
  loading?: boolean;
  onSyncProvider: (providerConfigId: string) => Promise<void>;
  onCheckProvider: (providerConfigId: string) => Promise<void>;
  onDeleteProvider: (providerConfigId: string) => Promise<void>;
  onSetModelEnabled: (modelId: string, enabled: boolean) => Promise<void>;
  onBatchSetModels: (modelIds: string[], enabled: boolean) => Promise<void>;
}

export function ModelCatalogTable({
  actorRole,
  providers,
  models,
  loading,
  onSyncProvider,
  onCheckProvider,
  onDeleteProvider,
  onSetModelEnabled,
  onBatchSetModels
}: ModelCatalogTableProps) {
  const formatDateTime = (value?: string | null): string => {
    if (!value) {
      return "未记录";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "未记录";
    }
    return date.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  const formatContextWindow = (value?: number | null): string => {
    if (!value || value <= 0) {
      return "--";
    }
    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(1)}M`;
    }
    if (value >= 1_000) {
      return `${(value / 1_000).toFixed(0)}K`;
    }
    return `${value}`;
  };

  const providerStatusLabel = (status: ProviderConfig["lastSyncStatus"]): string => {
    if (status === "healthy") return "同步健康";
    if (status === "syncing") return "同步中";
    if (status === "degraded") return "同步降级";
    if (status === "failed") return "同步失败";
    return "待同步";
  };

  const providerStatusVariant = (
    status: ProviderConfig["lastSyncStatus"]
  ): "default" | "secondary" | "destructive" | "outline" => {
    if (status === "healthy") return "secondary";
    if (status === "failed") return "destructive";
    if (status === "degraded") return "outline";
    if (status === "syncing") return "default";
    return "outline";
  };

  const modelHealthLabel = (status: ModelCatalogItem["healthStatus"]): string => {
    if (status === "healthy") return "健康";
    if (status === "degraded") return "降级";
    if (status === "failed") return "失败";
    return "未知";
  };

  const modelHealthVariant = (
    status: ModelCatalogItem["healthStatus"]
  ): "secondary" | "destructive" | "outline" => {
    if (status === "healthy") return "secondary";
    if (status === "failed") return "destructive";
    return "outline";
  };

  if (providers.length === 0) {
    return <StateBlock variant="idle">暂无厂商配置，请先添加厂商。</StateBlock>;
  }

  const sortedProviders = [...providers].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  );
  const allModelIds = models.map((item) => item.id);
  const hasEnabledModel = models.some((item) => item.enabled);
  const hasDisabledModel = models.some((item) => !item.enabled);
  const enabledModelCount = models.filter((item) => item.enabled).length;
  const healthyModelCount = models.filter((item) => item.healthStatus === "healthy").length;

  return (
    <section className="space-y-4 rounded-2xl border border-[rgba(148,163,184,0.38)] bg-[linear-gradient(160deg,rgba(248,250,252,0.84)_0%,rgba(255,255,255,0.95)_52%,rgba(239,246,255,0.62)_100%)] p-4 shadow-[0_12px_28px_rgba(15,23,42,0.06)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <PackageCheck className="h-4 w-4 text-emerald-600" />
            已安装模型供应商
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-[var(--text-secondary)]">
            <span className="inline-flex items-center gap-1 rounded-full border border-[rgba(148,163,184,0.45)] bg-white/80 px-2.5 py-1">
              <Radio className="h-3.5 w-3.5 text-[var(--action-primary)]" />
              供应商 {providers.length}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-[rgba(148,163,184,0.45)] bg-white/80 px-2.5 py-1">
              <CircleCheckBig className="h-3.5 w-3.5 text-emerald-600" />
              已启用模型 {enabledModelCount}/{models.length}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-[rgba(148,163,184,0.45)] bg-white/80 px-2.5 py-1">
              <HeartPulse className="h-3.5 w-3.5 text-cyan-600" />
              健康模型 {healthyModelCount}
            </span>
          </div>
        </div>

        {actorRole === "admin" ? (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="bg-white/80"
              disabled={loading || !hasDisabledModel}
              onClick={() => {
                void onBatchSetModels(allModelIds, true);
              }}
            >
              全部启动
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="bg-white/80"
              disabled={loading || !hasEnabledModel}
              onClick={() => {
                void onBatchSetModels(allModelIds, false);
              }}
            >
              全部关闭
            </Button>
          </div>
        ) : null}
      </div>

      <div className="space-y-3">
        {sortedProviders.map((provider) => {
          const rows = models
            .filter((item) => item.providerConfigId === provider.id)
            .sort((left, right) => Number(right.enabled) - Number(left.enabled));
          const enabledIds = rows.filter((item) => item.enabled).map((item) => item.id);
          const disabledIds = rows.filter((item) => !item.enabled).map((item) => item.id);
          const healthyCount = rows.filter((item) => item.healthStatus === "healthy").length;
          const tagSet = new Set<string>();
          for (const model of rows) {
            for (const capability of model.capabilities ?? []) {
              tagSet.add(capability.toUpperCase());
              if (tagSet.size >= 5) {
                break;
              }
            }
            if (tagSet.size >= 5) {
              break;
            }
          }
          const capabilityTags = Array.from(tagSet);

          return (
            <Collapsible
              key={provider.id}
              defaultOpen={false}
              className="group/provider rounded-xl border border-[rgba(148,163,184,0.35)] bg-white/90 p-4 shadow-[0_10px_24px_rgba(15,23,42,0.05)]"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[rgba(148,163,184,0.4)] bg-[linear-gradient(150deg,rgba(241,245,249,0.85)_0%,rgba(219,234,254,0.7)_100%)] text-xs font-semibold text-[var(--text-primary)]">
                      {provider.displayName.slice(0, 2).toUpperCase()}
                    </div>
                    <p className="text-sm font-semibold text-[var(--text-primary)]">{provider.displayName}</p>
                    <Badge variant="outline" className="bg-white/80">
                      {provider.provider}
                    </Badge>
                    <Badge variant={providerStatusVariant(provider.lastSyncStatus)}>
                      {providerStatusLabel(provider.lastSyncStatus)}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="bg-[var(--surface-subtle)]/70 text-[10px]">
                      模型总数 {rows.length}
                    </Badge>
                    <Badge variant="outline" className="bg-[var(--surface-subtle)]/70 text-[10px]">
                      启用 {enabledIds.length}
                    </Badge>
                    <Badge variant="outline" className="bg-[var(--surface-subtle)]/70 text-[10px]">
                      健康 {healthyCount}
                    </Badge>
                    {capabilityTags.length > 0 ? (
                      capabilityTags.map((tag) => (
                        <Badge key={`${provider.id}-${tag}`} variant="outline" className="bg-[var(--surface-subtle)]/70 text-[10px]">
                          {tag}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-[var(--text-tertiary)]">暂无能力标签</span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--text-tertiary)]">
                    最近同步：{formatDateTime(provider.lastSyncAt)} · 上次变更：{formatDateTime(provider.updatedAt)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {actorRole === "admin" ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="bg-white/85"
                        disabled={loading}
                        onClick={() => {
                          void onCheckProvider(provider.id);
                        }}
                      >
                        检测连通性
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="bg-white/85"
                        disabled={loading}
                        onClick={() => {
                          void onSyncProvider(provider.id);
                        }}
                      >
                        同步模型
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="bg-white/85"
                        disabled={loading || disabledIds.length === 0}
                        onClick={() => {
                          void onBatchSetModels(disabledIds, true);
                        }}
                      >
                        厂商全启用
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="bg-white/85"
                        disabled={loading || enabledIds.length === 0}
                        onClick={() => {
                          void onBatchSetModels(enabledIds, false);
                        }}
                      >
                        厂商全停用
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-rose-600 hover:text-rose-700"
                        disabled={loading}
                        onClick={() => {
                          void onDeleteProvider(provider.id);
                        }}
                      >
                        删除
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>

              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="mt-3 flex w-full items-center justify-between rounded-lg border border-[rgba(148,163,184,0.35)] bg-[linear-gradient(145deg,rgba(248,250,252,0.75)_0%,rgba(241,245,249,0.88)_100%)] px-3 py-2 text-left text-sm hover:bg-[var(--surface-hover)]"
                >
                  <span className="inline-flex items-center gap-2 text-[var(--text-secondary)]">
                    <Gauge className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                    {rows.length} 个模型（默认折叠）
                  </span>
                  <ChevronDown className="h-4 w-4 text-[var(--text-tertiary)] transition-transform group-data-[state=open]/provider:rotate-180" />
                </button>
              </CollapsibleTrigger>

              <CollapsibleContent className="space-y-2 pt-2">
                {rows.length === 0 ? (
                  <StateBlock variant="idle">暂无模型，点击“同步模型”拉取厂商目录。</StateBlock>
                ) : (
                  rows.map((model) => (
                    <article
                      key={model.id}
                      className={cn(
                        "rounded-xl border px-3 py-2.5 transition-colors",
                        model.enabled
                          ? "border-[rgba(148,163,184,0.38)] bg-white"
                          : "border-[rgba(148,163,184,0.35)] bg-[var(--surface-subtle)]/75"
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="space-y-0.5">
                          <p className="text-sm font-medium text-[var(--text-primary)]">{model.displayName}</p>
                          <p className="font-mono text-xs text-[var(--text-tertiary)]">{model.model}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={modelHealthVariant(model.healthStatus)}>
                            {modelHealthLabel(model.healthStatus)}
                          </Badge>
                          <Badge variant="outline">{model.enabled ? "已启用" : "已停用"}</Badge>
                          <Switch
                            checked={model.enabled}
                            disabled={loading || actorRole !== "admin"}
                            aria-label={`${model.model} enabled switch`}
                            onCheckedChange={(checked) => {
                              void onSetModelEnabled(model.id, checked);
                            }}
                          />
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <div className="flex flex-wrap gap-1">
                          {(model.capabilities ?? []).slice(0, 4).map((capability) => (
                            <Badge key={`${model.id}-${capability}`} variant="outline" className="bg-white/80 text-[10px]">
                              {capability.toUpperCase()}
                            </Badge>
                          ))}
                        </div>
                        <Badge variant="outline" className="text-[10px]">
                          上下文 {formatContextWindow(model.contextWindow)}
                        </Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[var(--text-tertiary)]">
                        <span>健康检查：{formatDateTime(model.lastHealthCheckAt)}</span>
                        <span>同步时间：{formatDateTime(model.lastSyncedAt)}</span>
                      </div>
                    </article>
                  ))
                )}
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>
    </section>
  );
}
