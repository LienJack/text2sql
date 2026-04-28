"use client";

import { useEffect, useState } from "react";
import type {
  RagTaskConfig,
  RagTaskConfigHealthRequest
} from "@text2sql/shared-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { StateBlock } from "@/components/ui/state-block";
import { RagProviderCardGrid } from "@/components/settings/rag-provider-card-grid";
import type {
  RagTaskConfigHealthResult,
  RagTaskConfigPayload
} from "@/lib/settings-api-client";

interface RagEmbeddingConfigPanelProps {
  actorRole: "admin" | "user";
  config: RagTaskConfig | null;
  loading?: boolean;
  onSave: (payload: RagTaskConfigPayload) => Promise<void>;
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
  const [lastSyncedConfigVersion, setLastSyncedConfigVersion] = useState("missing");
  const [remoteUpdateAvailable, setRemoteUpdateAvailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [saveError, setSaveError] = useState("");
  const [checkStatus, setCheckStatus] = useState("");
  const [checkError, setCheckError] = useState("");
  const [checkedAgainst, setCheckedAgainst] = useState<"draft" | "persisted" | null>(null);

  const configVersion = resolveConfigVersion(config);

  const syncFromConfig = (nextConfig: RagTaskConfig | null) => {
    setProvider(nextConfig?.provider ?? "");
    setModel(nextConfig?.model ?? "");
    setBaseUrl(nextConfig?.baseUrl ?? "");
    setApiKey("");
    setEnabled(nextConfig?.enabled ?? true);
    setDimensions(nextConfig?.dimensions ? String(nextConfig.dimensions) : "");
    setVectorVersion(nextConfig?.vectorVersion ?? "");
    setTimeoutMs(nextConfig?.timeoutMs ? String(nextConfig.timeoutMs) : "");
    setNote(nextConfig?.note ?? "");
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

  const readonly = actorRole !== "admin";

  const markDirty = () => {
    if (!dirty) {
      setDirty(true);
    }
    setSaveStatus("");
    setSaveError("");
  };

  return (
    <section className="space-y-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-subtle)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Embedding 配置</h3>
        <Badge variant="outline">{config?.configSource ?? "missing"}</Badge>
        <Badge variant="outline">{config?.healthStatus ?? "unknown"}</Badge>
        <Badge variant={dirty ? "secondary" : "outline"}>{dirty ? "draft" : "synced"}</Badge>
        {checkedAgainst ? (
          <Badge variant="outline">{`checked:${checkedAgainst}`}</Badge>
        ) : null}
      </div>

      {loading ? <StateBlock variant="loading">Embedding 配置加载中...</StateBlock> : null}
      {!config && !loading ? <StateBlock variant="idle">暂无 Embedding 配置</StateBlock> : null}
      <RagProviderCardGrid
        taskType="embedding"
        activeProvider={provider}
        readonly={readonly}
        loading={loading || saving}
        dirty={dirty}
        onSelectProvider={(preset) => {
          markDirty();
          setProvider(preset.provider);
          setModel(preset.recommendedModel);
          setBaseUrl(preset.defaultBaseUrl);
          if (!note.trim()) {
            setNote(`preset=${preset.provider};mode=${preset.mode}`);
          }
        }}
      />
      {remoteUpdateAvailable ? (
        <StateBlock variant="idle">
          检测到后台配置更新，当前草稿已保护。可继续编辑，或点击“重置为最新配置”覆盖草稿。
        </StateBlock>
      ) : null}

      <div className="grid gap-2 md:grid-cols-2">
        <Input
          value={provider}
          onChange={(event) => {
            markDirty();
            setProvider(event.target.value);
          }}
          placeholder="provider"
          aria-label="embedding-provider"
          disabled={readonly || loading || saving}
        />
        <Input
          value={model}
          onChange={(event) => {
            markDirty();
            setModel(event.target.value);
          }}
          placeholder="model"
          aria-label="embedding-model"
          disabled={readonly || loading || saving}
        />
        <Input
          value={baseUrl}
          onChange={(event) => {
            markDirty();
            setBaseUrl(event.target.value);
          }}
          placeholder="base url"
          aria-label="embedding-base-url"
          disabled={readonly || loading || saving}
        />
        <Input
          value={apiKey}
          onChange={(event) => {
            markDirty();
            setApiKey(event.target.value);
          }}
          placeholder={config?.apiKeyMasked ?? "api key"}
          aria-label="embedding-api-key"
          disabled={readonly || loading || saving}
        />
        <Input
          value={dimensions}
          onChange={(event) => {
            markDirty();
            setDimensions(event.target.value);
          }}
          placeholder="dimensions"
          aria-label="embedding-dimensions"
          disabled={readonly || loading || saving}
        />
        <Input
          value={vectorVersion}
          onChange={(event) => {
            markDirty();
            setVectorVersion(event.target.value);
          }}
          placeholder="vector version"
          aria-label="embedding-vector-version"
          disabled={readonly || loading || saving}
        />
        <Input
          value={timeoutMs}
          onChange={(event) => {
            markDirty();
            setTimeoutMs(event.target.value);
          }}
          placeholder="timeout ms"
          aria-label="embedding-timeout-ms"
          disabled={readonly || loading || saving}
        />
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

      <Input
        value={note}
        onChange={(event) => {
          markDirty();
          setNote(event.target.value);
        }}
        placeholder="note"
        aria-label="embedding-note"
        disabled={readonly || loading || saving}
      />

      {readonly ? (
        <StateBlock variant="idle">当前账号只读，可查看配置摘要。</StateBlock>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={loading || saving || provider.trim().length === 0 || model.trim().length === 0}
            onClick={() => {
              void (async () => {
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
                  setSaveStatus("保存成功，配置已写入。");
                } catch (error) {
                  setSaveError(error instanceof Error ? error.message : "保存失败");
                } finally {
                  setSaving(false);
                }
              })();
            }}
          >
            {saving ? "保存中..." : "保存 Embedding"}
          </Button>
          <Button
            variant="outline"
            disabled={loading || checking || provider.trim().length === 0 || model.trim().length === 0}
            onClick={() => {
              void (async () => {
                setChecking(true);
                setCheckStatus("");
                setCheckError("");
                try {
                  const result = await onHealthCheck({
                    expectedDimensions: dimensions.trim()
                      ? Number(dimensions)
                      : undefined,
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
              })();
            }}
          >
            {checking ? "检测中..." : "检测草稿（不保存）"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={loading || saving || checking}
            onClick={() => {
              syncFromConfig(config);
              setDirty(false);
              setRemoteUpdateAvailable(false);
              setLastSyncedConfigVersion(resolveConfigVersion(config));
              setSaveStatus("");
              setSaveError("");
              setCheckStatus("");
              setCheckError("");
            }}
          >
            重置为最新配置
          </Button>
        </div>
      )}

      {saveStatus ? <StateBlock variant="success">{saveStatus}</StateBlock> : null}
      {saveError ? <StateBlock variant="error">{saveError}</StateBlock> : null}
      {checkStatus ? <StateBlock variant="success">{checkStatus}</StateBlock> : null}
      {checkError ? <StateBlock variant="error">{checkError}</StateBlock> : null}
      {config ? (
        <p className="text-xs text-[var(--text-secondary)]">
          上次检查：{config.lastCheckedAt ?? "未检查"} · 来源说明：{config.configSourceNote ?? "无"}
        </p>
      ) : null}
    </section>
  );
}
