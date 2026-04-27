"use client";

import { useEffect, useState } from "react";
import type { RagTaskConfig } from "@text2sql/shared-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { StateBlock } from "@/components/ui/state-block";
import type {
  RagTaskConfigHealthResult,
  RagTaskConfigPayload
} from "@/lib/settings-api-client";

interface RagRerankConfigPanelProps {
  actorRole: "admin" | "user";
  config: RagTaskConfig | null;
  loading?: boolean;
  onSave: (payload: RagTaskConfigPayload) => Promise<void>;
  onHealthCheck: () => Promise<RagTaskConfigHealthResult>;
}

export function RagRerankConfigPanel({
  actorRole,
  config,
  loading = false,
  onSave,
  onHealthCheck
}: RagRerankConfigPanelProps) {
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [timeoutMs, setTimeoutMs] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setProvider(config?.provider ?? "");
    setModel(config?.model ?? "");
    setBaseUrl(config?.baseUrl ?? "");
    setApiKey("");
    setEnabled(config?.enabled ?? true);
    setTimeoutMs(config?.timeoutMs ? String(config.timeoutMs) : "");
    setNote(config?.note ?? "");
  }, [config]);

  const readonly = actorRole !== "admin";

  return (
    <section className="space-y-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-subtle)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Rerank 配置</h3>
        <Badge variant="outline">{config?.configSource ?? "missing"}</Badge>
        <Badge variant="outline">{config?.healthStatus ?? "unknown"}</Badge>
      </div>

      {loading ? <StateBlock variant="loading">Rerank 配置加载中...</StateBlock> : null}
      {!config && !loading ? <StateBlock variant="idle">暂无 Rerank 配置</StateBlock> : null}

      <div className="grid gap-2 md:grid-cols-2">
        <Input
          value={provider}
          onChange={(event) => setProvider(event.target.value)}
          placeholder="provider"
          aria-label="rerank-provider"
          disabled={readonly || loading || saving}
        />
        <Input
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder="model"
          aria-label="rerank-model"
          disabled={readonly || loading || saving}
        />
        <Input
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="base url"
          aria-label="rerank-base-url"
          disabled={readonly || loading || saving}
        />
        <Input
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={config?.apiKeyMasked ?? "api key"}
          aria-label="rerank-api-key"
          disabled={readonly || loading || saving}
        />
        <Input
          value={timeoutMs}
          onChange={(event) => setTimeoutMs(event.target.value)}
          placeholder="timeout ms"
          aria-label="rerank-timeout-ms"
          disabled={readonly || loading || saving}
        />
        <NativeSelect
          value={enabled ? "enabled" : "disabled"}
          onChange={(event) => setEnabled(event.target.value === "enabled")}
          aria-label="rerank-enabled"
          disabled={readonly || loading || saving}
        >
          <NativeSelectOption value="enabled">enabled</NativeSelectOption>
          <NativeSelectOption value="disabled">disabled</NativeSelectOption>
        </NativeSelect>
      </div>

      <Input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="note"
        aria-label="rerank-note"
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
                setMessage("");
                try {
                  await onSave({
                    provider: provider.trim(),
                    model: model.trim(),
                    baseUrl: baseUrl.trim() || undefined,
                    apiKey: apiKey.trim() || undefined,
                    enabled,
                    timeoutMs: timeoutMs.trim() ? Number(timeoutMs) : undefined,
                    note: note.trim() || undefined
                  });
                  setApiKey("");
                  setMessage("Rerank 配置已保存。");
                } catch (error) {
                  setMessage(error instanceof Error ? error.message : "保存失败");
                } finally {
                  setSaving(false);
                }
              })();
            }}
          >
            {saving ? "保存中..." : "保存 Rerank"}
          </Button>
          <Button
            variant="outline"
            disabled={loading || checking}
            onClick={() => {
              void (async () => {
                setChecking(true);
                setMessage("");
                try {
                  const result = await onHealthCheck();
                  setMessage(
                    `健康检查: ${result.status} · code=${result.reasonCode} · source=${result.configSource} · ${result.message}`
                  );
                } catch (error) {
                  setMessage(error instanceof Error ? error.message : "检测失败");
                } finally {
                  setChecking(false);
                }
              })();
            }}
          >
            {checking ? "检测中..." : "Sample Rerank"}
          </Button>
        </div>
      )}

      {message ? (
        <StateBlock variant={message.includes("失败") ? "error" : "success"}>{message}</StateBlock>
      ) : null}
      {config ? (
        <p className="text-xs text-[var(--text-secondary)]">
          上次检查：{config.lastCheckedAt ?? "未检查"} · 来源说明：{config.configSourceNote ?? "无"}
        </p>
      ) : null}
    </section>
  );
}
