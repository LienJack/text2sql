"use client";

import type { ModelCatalogItem, ProviderConfig } from "@text2sql/shared-types";
import { ChevronDown, Gauge, PackageCheck } from "lucide-react";
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
  if (providers.length === 0) {
    return <StateBlock variant="idle">暂无厂商配置，请先添加厂商。</StateBlock>;
  }

  const sortedProviders = [...providers].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  );
  const allModelIds = models.map((item) => item.id);
  const hasEnabledModel = models.some((item) => item.enabled);
  const hasDisabledModel = models.some((item) => !item.enabled);

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <PackageCheck className="h-4 w-4 text-teal-600" />
          已安装模型供应商
        </div>
        {actorRole === "admin" ? (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
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
          const rows = models.filter((item) => item.providerConfigId === provider.id);
          const enabledIds = rows.filter((item) => item.enabled).map((item) => item.id);
          const disabledIds = rows.filter((item) => !item.enabled).map((item) => item.id);
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
              className="group/provider rounded-lg border border-slate-200 bg-white p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900">{provider.displayName}</p>
                    <Badge variant="outline">{provider.provider}</Badge>
                    <Badge
                      variant={provider.lastSyncStatus === "failed" ? "destructive" : "secondary"}
                    >
                      {provider.lastSyncStatus}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {capabilityTags.length > 0 ? (
                      capabilityTags.map((tag) => (
                        <Badge key={`${provider.id}-${tag}`} variant="outline" className="text-[10px]">
                          {tag}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-slate-500">暂无能力标签</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {actorRole === "admin" ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
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
                  className="mt-3 flex w-full items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm hover:bg-slate-100"
                >
                  <span className="inline-flex items-center gap-2 text-slate-700">
                    <Gauge className="h-3.5 w-3.5 text-slate-500" />
                    {rows.length} 个模型（默认折叠）
                  </span>
                  <ChevronDown className="h-4 w-4 text-slate-500 transition-transform group-data-[state=open]/provider:rotate-180" />
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
                        "rounded-md border px-3 py-2",
                        model.enabled ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-50"
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="space-y-0.5">
                          <p className="text-sm font-medium text-slate-900">{model.displayName}</p>
                          <p className="font-mono text-xs text-slate-500">{model.model}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={model.healthStatus === "failed" ? "destructive" : "secondary"}>
                            {model.healthStatus}
                          </Badge>
                          <Badge variant="outline">{model.enabled ? "已启用" : "已停用"}</Badge>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <div className="flex flex-wrap gap-1">
                          {(model.capabilities ?? []).slice(0, 4).map((capability) => (
                            <Badge key={`${model.id}-${capability}`} variant="outline" className="text-[10px]">
                              {capability.toUpperCase()}
                            </Badge>
                          ))}
                        </div>
                        <Switch
                          checked={model.enabled}
                          disabled={loading || actorRole !== "admin"}
                          aria-label={`${model.model} enabled switch`}
                          onCheckedChange={(checked) => {
                            void onSetModelEnabled(model.id, checked);
                          }}
                        />
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
