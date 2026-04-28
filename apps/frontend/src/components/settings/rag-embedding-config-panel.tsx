"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  LlmProviderCode,
  RagTaskConfig,
  RagTaskConfigHealthRequest
} from "@text2sql/shared-types";
import { ChevronDown, RefreshCw, Settings2, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { StateBlock } from "@/components/ui/state-block";
import {
  RagProviderCardGrid,
  resolveRagProviderPreset
} from "@/components/settings/rag-provider-card-grid";
import type {
  RagProviderModelPreviewResult,
  RagTaskConfigHealthResult,
  RagTaskConfigPayload
} from "@/lib/settings-api-client";

interface RagEmbeddingConfigPanelProps {
  actorRole: "admin" | "user";
  config: RagTaskConfig | null;
  loading?: boolean;
  onSave: (payload: RagTaskConfigPayload) => Promise<void>;
  onFetchModels: (payload: {
    provider: LlmProviderCode;
    baseUrl?: string;
    apiKey: string;
  }) => Promise<RagProviderModelPreviewResult>;
  onHealthCheck: (
    payload: RagTaskConfigHealthRequest
  ) => Promise<RagTaskConfigHealthResult>;
}

function resolveConfigVersion(config: RagTaskConfig | null): string {
  if (!config) {
    return "missing";
  }
  return [
    config.id,
    config.updatedAt,
    config.provider,
    config.model,
    config.baseUrl ?? "",
    config.enabled ? "1" : "0",
    config.dimensions ?? "",
    config.vectorVersion ?? "",
    config.timeoutMs ?? ""
  ].join(":");
}

export function RagEmbeddingConfigPanel({
  actorRole,
  config,
  loading = false,
  onSave,
  onFetchModels,
  onHealthCheck
}: RagEmbeddingConfigPanelProps) {
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [dimensions, setDimensions] = useState("");
  const [vectorVersion, setVectorVersion] = useState("");
  const [timeoutMs, setTimeoutMs] = useState("");
  const [note, setNote] = useState("");
  const [dirty, setDirty] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [lastSyncedConfigVersion, setLastSyncedConfigVersion] = useState("missing");
  const [remoteUpdateAvailable, setRemoteUpdateAvailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [saveError, setSaveError] = useState("");
  const [checkStatus, setCheckStatus] = useState("");
  const [checkError, setCheckError] = useState("");
  const [checkedAgainst, setCheckedAgainst] = useState<"draft" | "persisted" | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelFetchStatus, setModelFetchStatus] = useState("");
  const [modelFetchError, setModelFetchError] = useState("");
  const [modelOptions, setModelOptions] = useState<RagProviderModelPreviewResult["models"]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const configVersion = resolveConfigVersion(config);
  const readonly = actorRole !== "admin";
  const selectedPreset = useMemo(
    () => resolveRagProviderPreset("embedding", provider),
    [provider]
  );
  const currentPreset = useMemo(
    () => resolveRagProviderPreset("embedding", config?.provider),
    [config?.provider]
  );

  const syncFromConfig = (nextConfig: RagTaskConfig | null) => {
    setProvider(nextConfig?.provider ?? "");
    setModel(nextConfig?.model ?? "");
    setBaseUrl(nextConfig?.baseUrl ?? "");
    setApiKey("");
    setEnabled(nextConfig?.enabled ?? true);
    setDimensions(
      nextConfig?.configSource === "settings" && nextConfig.dimensions
        ? String(nextConfig.dimensions)
        : ""
    );
    setVectorVersion(
      nextConfig?.configSource === "settings" ? (nextConfig.vectorVersion ?? "") : ""
    );
    setTimeoutMs(nextConfig?.timeoutMs ? String(nextConfig.timeoutMs) : "");
    setNote(nextConfig?.note ?? "");
    setModelOptions([]);
    setModelFetchStatus("");
    setModelFetchError("");
    setAdvancedOpen(false);
  };

  useEffect(() => {
    if (!dirty) {
      syncFromConfig(config);
      setLastSyncedConfigVersion(configVersion);
      setRemoteUpdateAvailable(false);
      return;
    }
    if (configVersion !== lastSyncedConfigVersion) {
      setRemoteUpdateAvailable(true);
    }
  }, [config, configVersion, dirty, lastSyncedConfigVersion]);

  const markDirty = () => {
    if (!dirty) {
      setDirty(true);
    }
    setSaveStatus("");
    setSaveError("");
    setCheckStatus("");
    setCheckError("");
    setModelFetchStatus("");
    setModelFetchError("");
    setCheckedAgainst(null);
  };

  const openCurrentDraft = () => {
    setDialogOpen(true);
  };

  const resetToLatest = () => {
    syncFromConfig(config);
    setDirty(false);
    setRemoteUpdateAvailable(false);
    setLastSyncedConfigVersion(resolveConfigVersion(config));
    setSaveStatus("");
    setSaveError("");
    setCheckStatus("");
    setCheckError("");
    setModelFetchStatus("");
    setModelFetchError("");
    setCheckedAgainst(null);
  };

  const fetchModels = async () => {
    if (!provider.trim()) {
      setModelFetchError("请先选择 Provider。");
      return;
    }
    if (!apiKey.trim()) {
      setModelFetchError("请先填写 API Key，再获取模型。");
      return;
    }

    setFetchingModels(true);
    setModelFetchStatus("");
    setModelFetchError("");
    try {
      const result = await onFetchModels({
        provider: provider as LlmProviderCode,
        baseUrl: baseUrl.trim() || undefined,
        apiKey: apiKey.trim()
      });
      setModelOptions(result.models);
      const nextModel =
        result.recommendedModel && result.models.some((item) => item.model === result.recommendedModel)
          ? result.recommendedModel
          : result.models[0]?.model;
      if (!model.trim() && nextModel) {
        setModel(nextModel);
      }
      setModelFetchStatus(
        result.models.length > 0
          ? `已拉取 ${result.models.length} 个官方模型，可直接选择或继续手动填写。`
          : "已请求官方模型目录，但当前未返回可选模型。"
      );
    } catch (error) {
      setModelOptions([]);
      setModelFetchError(error instanceof Error ? error.message : "获取模型失败");
    } finally {
      setFetchingModels(false);
    }
  };

  const saveDraft = async () => {
    setSaving(true);
    setSaveStatus("");
    setSaveError("");
    try {
      await onSave({
        provider: provider.trim(),
        model: model.trim(),
        baseUrl: baseUrl.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
        enabled,
        dimensions: dimensions.trim() ? Number(dimensions) : undefined,
        vectorVersion: vectorVersion.trim() || undefined,
        timeoutMs: timeoutMs.trim() ? Number(timeoutMs) : undefined,
        note: note.trim() || undefined
      });
      setApiKey("");
      setDirty(false);
      setRemoteUpdateAvailable(false);
      setSaveStatus("保存成功，Embedding 配置已写入。");
      setDialogOpen(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const checkDraft = async () => {
    setChecking(true);
    setCheckStatus("");
    setCheckError("");
    try {
      const result = await onHealthCheck({
        expectedDimensions: dimensions.trim() ? Number(dimensions) : undefined,
        draft: {
          provider: provider.trim(),
          model: model.trim(),
          baseUrl: baseUrl.trim() || undefined,
          apiKey: apiKey.trim() || undefined,
          enabled,
          dimensions: dimensions.trim() ? Number(dimensions) : undefined,
          vectorVersion: vectorVersion.trim() || undefined,
          timeoutMs: timeoutMs.trim() ? Number(timeoutMs) : undefined,
          note: note.trim() || undefined
        }
      });
      setCheckedAgainst(result.checkedAgainst);
      setCheckStatus(
        `检测结果: ${result.status} · code=${result.reasonCode} · source=${result.configSource} · checkedAgainst=${result.checkedAgainst}`
      );
    } catch (error) {
      setCheckError(error instanceof Error ? error.message : "检测失败");
    } finally {
      setChecking(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-3xl border border-[rgba(148,163,184,0.28)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.95)_58%,rgba(243,247,255,0.98)_100%)] shadow-[0_16px_36px_rgba(15,23,42,0.06)]">
      <div className="border-b border-[rgba(148,163,184,0.16)] bg-[linear-gradient(135deg,rgba(239,246,255,0.78)_0%,rgba(255,255,255,0.5)_100%)] p-5">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[rgba(37,99,235,0.12)] text-[var(--action-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                  <Settings2 className="h-4.5 w-4.5" />
                </div>
                <div>
                  <p className="text-[11px] font-semibold tracking-[0.16em] text-[var(--text-tertiary)] uppercase">
                    Embedding Workspace
                  </p>
                  <h3 className="text-xl font-semibold text-[var(--text-primary)]">
                    Embedding Provider
                  </h3>
                </div>
              </div>
              <p className="max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
                管理向量模型接入、密钥与维度参数。先选供应商，填好 API Key 后可直接获取官方模型，再做连通性验证并保存。
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline" className="bg-white/90">
                {config?.configSource ?? "missing"}
              </Badge>
              <Badge variant="outline" className="bg-white/90">
                {config?.healthStatus ?? "unknown"}
              </Badge>
              <Badge variant={dirty ? "secondary" : "outline"} className="bg-white/90">
                {dirty ? "draft" : "synced"}
              </Badge>
              {checkedAgainst ? (
                <Badge variant="outline" className="bg-white/90">{`checked:${checkedAgainst}`}</Badge>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.1fr_1.3fr_auto]">
            <div className="rounded-2xl border border-[rgba(148,163,184,0.22)] bg-white/88 p-4">
              <p className="text-[11px] font-semibold tracking-[0.1em] text-[var(--text-tertiary)] uppercase">
                当前生效 Provider
              </p>
              <p className="mt-2 text-lg font-semibold text-[var(--text-primary)]">
                {currentPreset?.displayName ?? config?.provider ?? "尚未配置"}
              </p>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                {config?.baseUrl ?? "Base URL 将在弹窗中配置"}
              </p>
            </div>
            <div className="rounded-2xl border border-[rgba(148,163,184,0.22)] bg-white/88 p-4">
              <p className="text-[11px] font-semibold tracking-[0.1em] text-[var(--text-tertiary)] uppercase">
                当前模型与索引参数
              </p>
              <p className="mt-2 break-all text-base font-semibold text-[var(--text-primary)]">
                {config?.model ?? "点击卡片后填写模型"}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant="outline" className="bg-[var(--surface-subtle)] text-[10px]">
                  {config?.hasApiKey ? "API Key 已配置" : "API Key 待填写"}
                </Badge>
                <Badge variant="outline" className="bg-[var(--surface-subtle)] text-[10px]">
                  {config?.dimensions ? `dim=${config.dimensions}` : "维度未指定"}
                </Badge>
                <Badge variant="outline" className="bg-[var(--surface-subtle)] text-[10px]">
                  {config?.vectorVersion ? `vector=${config.vectorVersion}` : "vector 未指定"}
                </Badge>
              </div>
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full bg-white/90 xl:w-auto"
                disabled={loading || saving}
                onClick={openCurrentDraft}
              >
                {provider.trim() ? "编辑当前草稿" : "手动填写"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-5">
      {loading ? <StateBlock variant="loading">Embedding 配置加载中...</StateBlock> : null}
      {!config && !loading ? (
        <StateBlock variant="idle">
          当前还没有 Embedding 配置，直接点击卡片即可开始接入。
        </StateBlock>
      ) : null}
      {remoteUpdateAvailable ? (
        <StateBlock variant="idle">
          检测到后台配置更新，当前草稿已保护。可继续编辑，或在弹窗里重置为最新配置。
        </StateBlock>
      ) : null}
      <RagProviderCardGrid
        taskType="embedding"
        activeProvider={provider}
        readonly={readonly}
        loading={loading || saving}
        dirty={dirty}
        onSelectProvider={(preset) => {
          if (preset.provider === provider.trim()) {
            setDialogOpen(true);
            return;
          }
          markDirty();
          setProvider(preset.provider);
          setModel(preset.recommendedModel);
          setBaseUrl(preset.defaultBaseUrl);
          if (!note.trim()) {
            setNote(`preset=${preset.provider}${preset.mode ? `;mode=${preset.mode}` : ""}`);
          }
          setDialogOpen(true);
        }}
      />
      {readonly ? (
        <StateBlock variant="idle">当前账号只读，可查看配置摘要。</StateBlock>
      ) : null}
      {saveStatus ? <StateBlock variant="success">{saveStatus}</StateBlock> : null}
      {saveError ? <StateBlock variant="error">{saveError}</StateBlock> : null}
      {config ? (
        <p className="text-xs text-[var(--text-secondary)]">
          上次检查：{config.lastCheckedAt ?? "未检查"} · 来源说明：{config.configSourceNote ?? "无"}
        </p>
      ) : null}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle>
                配置 Embedding: {(selectedPreset?.displayName ?? provider) || "新 Provider"}
              </DialogTitle>
              <DialogDescription>
                先选 Provider、填写 API Key，再获取官方模型目录。高级参数默认可留空，系统会回退到 provider/model 默认值。
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-2xl border border-[rgba(148,163,184,0.26)] bg-[var(--surface-subtle)]/80 p-3">
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                <Badge variant="outline" className="bg-white text-[10px]">
                  <ShieldCheck className="h-3 w-3" />
                  草稿检测不落库
                </Badge>
                <Badge variant="outline" className="bg-white text-[10px]">
                  保存后立即生效
                </Badge>
                <Badge variant="outline" className="bg-white text-[10px]">
                  {apiKey.trim() || config?.hasApiKey ? "已具备鉴权信息" : "需填写 API Key"}
                </Badge>
              </div>
            </div>

            {remoteUpdateAvailable ? (
              <StateBlock variant="idle">
                后台配置已更新；当前弹窗仍保留你的草稿，可继续调整或重置。
              </StateBlock>
            ) : null}

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5 md:col-span-2">
                <Label>Provider</Label>
                <div className="rounded-2xl border border-[rgba(148,163,184,0.22)] bg-white/90 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--text-primary)]">
                      {selectedPreset?.displayName ?? currentPreset?.displayName ?? "请从上方卡片选择"}
                    </span>
                    {provider.trim() ? (
                      <Badge variant="outline" className="bg-[var(--surface-subtle)] text-[10px]">
                        {provider}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    Provider 通过卡片选择，不需要手动填写。
                  </p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="embedding-model">Model</Label>
                <Input
                  id="embedding-model"
                  value={model}
                  onChange={(event) => {
                    markDirty();
                    setModel(event.target.value);
                  }}
                  placeholder="model"
                  aria-label="embedding-model"
                  disabled={readonly || loading || saving}
                />
              </div>
              <div className="space-y-1.5">
                <Label>官方模型目录</Label>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-center bg-white/90"
                  disabled={readonly || loading || saving || fetchingModels || provider.trim().length === 0}
                  onClick={() => {
                    void fetchModels();
                  }}
                >
                  <RefreshCw className={fetchingModels ? "animate-spin" : ""} />
                  {fetchingModels ? "获取中..." : "获取模型"}
                </Button>
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="embedding-base-url">Base URL</Label>
                <Input
                  id="embedding-base-url"
                  value={baseUrl}
                  onChange={(event) => {
                    markDirty();
                    setBaseUrl(event.target.value);
                  }}
                  placeholder="base url"
                  aria-label="embedding-base-url"
                  disabled={readonly || loading || saving}
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="embedding-api-key">API Key</Label>
                <Input
                  id="embedding-api-key"
                  type="password"
                  value={apiKey}
                  onChange={(event) => {
                    markDirty();
                    setApiKey(event.target.value);
                  }}
                  placeholder={config?.apiKeyMasked ?? "api key"}
                  aria-label="embedding-api-key"
                  disabled={readonly || loading || saving}
                />
              </div>
              {modelOptions.length > 0 ? (
                <div className="space-y-1.5 md:col-span-2">
                  <Label>从官网返回的模型中选择</Label>
                  <Select
                    value={modelOptions.some((item) => item.model === model) ? model : ""}
                    onValueChange={(value) => {
                      markDirty();
                      setModel(value);
                    }}
                    disabled={readonly || loading || saving}
                  >
                    <SelectTrigger className="h-11 w-full bg-white/90">
                      <SelectValue placeholder="选择一个返回的模型，并自动带入下方 Model" />
                    </SelectTrigger>
                    <SelectContent position="popper" align="start">
                      {modelOptions.map((item) => (
                        <SelectItem key={item.model} value={item.model}>
                          {item.displayName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              <div className="md:col-span-2">
                <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                  <div className="rounded-2xl border border-[rgba(148,163,184,0.2)] bg-[var(--surface-subtle)]/70">
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between px-4 py-3 text-left"
                      >
                        <div>
                          <p className="text-sm font-semibold text-[var(--text-primary)]">高级选项</p>
                          <p className="text-xs text-[var(--text-secondary)]">
                            Dimensions 默认跟随 provider/model 原生维度；Vector Version 默认使用系统当前版本 {config?.vectorVersion ?? "v1"}。
                          </p>
                        </div>
                        <ChevronDown
                          className={`h-4 w-4 text-[var(--text-tertiary)] transition-transform ${
                            advancedOpen ? "rotate-180" : ""
                          }`}
                        />
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="border-t border-[rgba(148,163,184,0.16)] px-4 py-4">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="embedding-dimensions">Dimensions</Label>
                          <Input
                            id="embedding-dimensions"
                            value={dimensions}
                            onChange={(event) => {
                              markDirty();
                              setDimensions(event.target.value);
                            }}
                            placeholder="留空=自动"
                            aria-label="embedding-dimensions"
                            disabled={readonly || loading || saving}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="embedding-vector-version">Vector Version</Label>
                          <Input
                            id="embedding-vector-version"
                            value={vectorVersion}
                            onChange={(event) => {
                              markDirty();
                              setVectorVersion(event.target.value);
                            }}
                            placeholder={config?.vectorVersion ?? "v1"}
                            aria-label="embedding-vector-version"
                            disabled={readonly || loading || saving}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="embedding-timeout-ms">Timeout</Label>
                          <Input
                            id="embedding-timeout-ms"
                            value={timeoutMs}
                            onChange={(event) => {
                              markDirty();
                              setTimeoutMs(event.target.value);
                            }}
                            placeholder="timeout ms"
                            aria-label="embedding-timeout-ms"
                            disabled={readonly || loading || saving}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="embedding-enabled">Status</Label>
                          <NativeSelect
                            value={enabled ? "enabled" : "disabled"}
                            onChange={(event) => {
                              markDirty();
                              setEnabled(event.target.value === "enabled");
                            }}
                            aria-label="embedding-enabled"
                            disabled={readonly || loading || saving}
                          >
                            <NativeSelectOption value="enabled">enabled</NativeSelectOption>
                            <NativeSelectOption value="disabled">disabled</NativeSelectOption>
                          </NativeSelect>
                        </div>
                        <div className="space-y-1.5 md:col-span-2">
                          <Label htmlFor="embedding-note">Note</Label>
                          <Input
                            id="embedding-note"
                            value={note}
                            onChange={(event) => {
                              markDirty();
                              setNote(event.target.value);
                            }}
                            placeholder="可选备注"
                            aria-label="embedding-note"
                            disabled={readonly || loading || saving}
                          />
                        </div>
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              </div>
            </div>

            {modelFetchStatus ? <StateBlock variant="success">{modelFetchStatus}</StateBlock> : null}
            {modelFetchError ? <StateBlock variant="error">{modelFetchError}</StateBlock> : null}
            {checkStatus ? <StateBlock variant="success">{checkStatus}</StateBlock> : null}
            {checkError ? <StateBlock variant="error">{checkError}</StateBlock> : null}
            {saveError ? <StateBlock variant="error">{saveError}</StateBlock> : null}

            <DialogFooter showCloseButton>
              {!readonly ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={loading || saving || checking}
                    onClick={resetToLatest}
                  >
                    重置为最新配置
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={loading || checking || provider.trim().length === 0 || model.trim().length === 0}
                    onClick={() => {
                      void checkDraft();
                    }}
                  >
                    {checking ? "检测中..." : "检测草稿（不保存）"}
                  </Button>
                  <Button
                    type="button"
                    disabled={loading || saving || provider.trim().length === 0 || model.trim().length === 0}
                    onClick={() => {
                      void saveDraft();
                    }}
                  >
                    {saving ? "保存中..." : "保存并生效"}
                  </Button>
                </>
              ) : null}
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
