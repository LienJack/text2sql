"use client";

import { Badge } from "@/components/ui/badge";
import { StateBlock } from "@/components/ui/state-block";
import { cn } from "@/lib/utils";

export type RagProviderTaskType = "embedding" | "rerank";

export interface RagProviderPreset {
  provider: "volcengine" | "tongyi" | "siliconflow";
  displayName: string;
  defaultBaseUrl: string;
  recommendedModel: string;
  mode: "compatible" | "native";
  tags: string[];
  hint: string;
}

interface RagProviderCardGridProps {
  taskType: RagProviderTaskType;
  activeProvider?: string | null;
  readonly?: boolean;
  loading?: boolean;
  dirty?: boolean;
  onSelectProvider: (preset: RagProviderPreset) => void;
}

const EMBEDDING_PRESETS: RagProviderPreset[] = [
  {
    provider: "volcengine",
    displayName: "火山引擎 Ark",
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    recommendedModel: "doubao-embedding-text-240715",
    mode: "compatible",
    tags: ["EMBEDDING", "CN"],
    hint: "OpenAI 兼容模式"
  },
  {
    provider: "tongyi",
    displayName: "百炼 DashScope",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    recommendedModel: "text-embedding-v4",
    mode: "compatible",
    tags: ["EMBEDDING", "ALIBABA"],
    hint: "compatible 默认，native 走高级配置"
  },
  {
    provider: "siliconflow",
    displayName: "硅基流动",
    defaultBaseUrl: "https://api.siliconflow.cn/v1",
    recommendedModel: "BAAI/bge-m3",
    mode: "compatible",
    tags: ["EMBEDDING", "AGGREGATOR"],
    hint: "/v1/embeddings"
  }
];

const RERANK_PRESETS: RagProviderPreset[] = [
  {
    provider: "volcengine",
    displayName: "火山引擎 Ark",
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    recommendedModel: "doubao-rerank-v1",
    mode: "compatible",
    tags: ["RERANK", "CN"],
    hint: "兼容模式可直接接入"
  },
  {
    provider: "tongyi",
    displayName: "百炼 DashScope",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    recommendedModel: "gte-rerank-v2",
    mode: "compatible",
    tags: ["RERANK", "ALIBABA"],
    hint: "compatible 默认，native 可切换"
  },
  {
    provider: "siliconflow",
    displayName: "硅基流动",
    defaultBaseUrl: "https://api.siliconflow.cn/v1",
    recommendedModel: "BAAI/bge-reranker-v2-m3",
    mode: "compatible",
    tags: ["RERANK", "AGGREGATOR"],
    hint: "/v1/rerank"
  }
];

function listPresets(taskType: RagProviderTaskType): RagProviderPreset[] {
  return taskType === "embedding" ? EMBEDDING_PRESETS : RERANK_PRESETS;
}

export function RagProviderCardGrid({
  taskType,
  activeProvider,
  readonly = false,
  loading = false,
  dirty = false,
  onSelectProvider
}: RagProviderCardGridProps) {
  const presets = listPresets(taskType);

  return (
    <section className="space-y-2 rounded-xl border border-[var(--border-default)] bg-white/70 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold tracking-[0.08em] text-[var(--text-secondary)] uppercase">
          {taskType === "embedding" ? "Embedding Provider Presets" : "Rerank Provider Presets"}
        </p>
        <Badge variant="outline">{taskType}</Badge>
        {readonly ? <Badge variant="outline">readonly</Badge> : null}
      </div>
      {readonly ? (
        <StateBlock variant="idle">当前账号只读，可查看已激活 provider。</StateBlock>
      ) : null}
      <div className="grid gap-2 md:grid-cols-3">
        {presets.map((preset) => {
          const active = activeProvider?.trim() === preset.provider;
          return (
            <button
              key={`${taskType}-${preset.provider}`}
              type="button"
              aria-label={`${taskType}-preset-${preset.provider}`}
              className={cn(
                "rounded-lg border p-2 text-left transition-colors",
                active
                  ? "border-[var(--action-primary)] bg-[var(--surface-subtle)]"
                  : "border-[var(--border-default)] bg-white hover:border-[var(--action-primary)]",
                readonly ? "cursor-default opacity-80" : ""
              )}
              disabled={readonly || loading}
              onClick={() => {
                if (readonly || loading) {
                  return;
                }
                if (
                  dirty &&
                  typeof window !== "undefined" &&
                  !window.confirm("当前有未保存草稿。切换预置将覆盖草稿，是否继续？")
                ) {
                  return;
                }
                onSelectProvider(preset);
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-[var(--text-primary)]">{preset.displayName}</p>
                <Badge variant="outline" className="text-[10px]">
                  {preset.mode}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">{preset.hint}</p>
              <p className="mt-1 truncate text-[11px] text-[var(--text-tertiary)]">
                model: {preset.recommendedModel}
              </p>
              <p className="truncate text-[11px] text-[var(--text-tertiary)]">
                baseUrl: {preset.defaultBaseUrl}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {preset.tags.map((tag) => (
                  <Badge key={`${preset.provider}-${tag}`} variant="outline" className="text-[10px]">
                    {tag}
                  </Badge>
                ))}
              </div>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-[var(--text-tertiary)]">
        也可直接手动填写自定义 provider/model/baseUrl（custom fallback）。
      </p>
    </section>
  );
}
