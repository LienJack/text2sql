"use client";

import type { LlmProviderCode } from "@text2sql/shared-types";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StateBlock } from "@/components/ui/state-block";
import { cn } from "@/lib/utils";

export type RagProviderTaskType = "embedding" | "rerank";

export interface RagProviderPreset {
  provider: LlmProviderCode;
  displayName: string;
  summary: string;
  defaultBaseUrl: string;
  recommendedModel: string;
  mode?: "compatible" | "native";
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

const PROVIDER_CARD_STYLE: Record<LlmProviderCode, string> = {
  openai: "from-slate-900 to-slate-700 text-white",
  gemini: "from-emerald-600 to-cyan-600 text-white",
  deepseek: "from-indigo-700 to-sky-600 text-white",
  kimi: "from-sky-700 to-blue-500 text-white",
  volcengine: "from-orange-600 to-rose-500 text-white",
  siliconflow: "from-teal-600 to-emerald-500 text-white",
  openrouter: "from-slate-700 to-indigo-600 text-white",
  minimax: "from-fuchsia-600 to-pink-500 text-white",
  "tencent-hunyuan": "from-sky-700 to-cyan-600 text-white",
  tongyi: "from-amber-600 to-orange-500 text-white"
};

const EMBEDDING_PRESETS: RagProviderPreset[] = [
  {
    provider: "openai",
    displayName: "OpenAI",
    summary: "通用 Embedding 接入，适合英文与混合文本检索。",
    defaultBaseUrl: "https://api.openai.com/v1",
    recommendedModel: "text-embedding-3-small",
    tags: ["EMBEDDING", "OPENAI"],
    hint: "推荐走 /embeddings"
  },
  {
    provider: "gemini",
    displayName: "Gemini",
    summary: "Google 多模态生态，可接入原生 Embedding 模型。",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    recommendedModel: "",
    tags: ["EMBEDDING", "MULTIMODAL"],
    hint: "模型需手动确认"
  },
  {
    provider: "deepseek",
    displayName: "DeepSeek",
    summary: "适合统一使用兼容网关时的 Embedding 接入。",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    recommendedModel: "",
    tags: ["EMBEDDING", "REASONING"],
    hint: "模型需手动确认"
  },
  {
    provider: "kimi",
    displayName: "Kimi",
    summary: "适合长上下文知识场景，可手动填写对应模型。",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    recommendedModel: "",
    tags: ["EMBEDDING", "LONG_CTX"],
    hint: "模型需手动确认"
  },
  {
    provider: "volcengine",
    displayName: "火山引擎",
    summary: "Ark 兼容模式接入，适合中文语义检索。",
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    recommendedModel: "doubao-embedding-text-240715",
    mode: "compatible",
    tags: ["EMBEDDING", "CN"],
    hint: "兼容模式默认可用"
  },
  {
    provider: "siliconflow",
    displayName: "硅基流动",
    summary: "聚合平台接入，适合快速验证 BGE 向量模型。",
    defaultBaseUrl: "https://api.siliconflow.cn/v1",
    recommendedModel: "BAAI/bge-m3",
    mode: "compatible",
    tags: ["EMBEDDING", "AGGREGATOR"],
    hint: "推荐 BGE 系列"
  },
  {
    provider: "openrouter",
    displayName: "OpenRouter",
    summary: "聚合多家供应商，便于后续统一切换。",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    recommendedModel: "",
    tags: ["EMBEDDING", "ROUTER"],
    hint: "模型需手动确认"
  },
  {
    provider: "minimax",
    displayName: "MiniMax",
    summary: "适合统一平台治理时补充 Embedding 能力。",
    defaultBaseUrl: "https://api.minimax.chat/v1",
    recommendedModel: "",
    tags: ["EMBEDDING", "CHAT"],
    hint: "模型需手动确认"
  },
  {
    provider: "tencent-hunyuan",
    displayName: "腾讯混元",
    summary: "企业网关兼容接入，可统一纳入治理视图。",
    defaultBaseUrl: "https://api.hunyuan.cloud.tencent.com/v1",
    recommendedModel: "",
    tags: ["EMBEDDING", "COMPATIBLE"],
    hint: "模型需手动确认"
  },
  {
    provider: "tongyi",
    displayName: "通义",
    summary: "DashScope 兼容模式下可直接接入向量模型。",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    recommendedModel: "text-embedding-v4",
    mode: "compatible",
    tags: ["EMBEDDING", "ALIBABA"],
    hint: "推荐 text-embedding-v4"
  }
];

const RERANK_PRESETS: RagProviderPreset[] = [
  {
    provider: "openai",
    displayName: "OpenAI",
    summary: "适合以通用推理模型做轻量 rerank 验证。",
    defaultBaseUrl: "https://api.openai.com/v1",
    recommendedModel: "gpt-4.1-mini",
    tags: ["RERANK", "OPENAI"],
    hint: "LLM rerank"
  },
  {
    provider: "gemini",
    displayName: "Gemini",
    summary: "适合长上下文重排，可手动指定候选模型。",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    recommendedModel: "",
    tags: ["RERANK", "MULTIMODAL"],
    hint: "模型需手动确认"
  },
  {
    provider: "deepseek",
    displayName: "DeepSeek",
    summary: "推理导向模型，适合复杂文本对比与排序。",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    recommendedModel: "",
    tags: ["RERANK", "REASONING"],
    hint: "模型需手动确认"
  },
  {
    provider: "kimi",
    displayName: "Kimi",
    summary: "可用于长文档场景下的语义重排。",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    recommendedModel: "",
    tags: ["RERANK", "LONG_CTX"],
    hint: "模型需手动确认"
  },
  {
    provider: "volcengine",
    displayName: "火山引擎",
    summary: "Ark 兼容模式支持专用 rerank 接口。",
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    recommendedModel: "doubao-rerank-v1",
    mode: "compatible",
    tags: ["RERANK", "CN"],
    hint: "推荐 /rerank"
  },
  {
    provider: "siliconflow",
    displayName: "硅基流动",
    summary: "聚合模型平台，适合快速验证 reranker。",
    defaultBaseUrl: "https://api.siliconflow.cn/v1",
    recommendedModel: "BAAI/bge-reranker-v2-m3",
    mode: "compatible",
    tags: ["RERANK", "AGGREGATOR"],
    hint: "推荐 BGE reranker"
  },
  {
    provider: "openrouter",
    displayName: "OpenRouter",
    summary: "统一供应商入口，适合平台层切换治理。",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    recommendedModel: "",
    tags: ["RERANK", "ROUTER"],
    hint: "模型需手动确认"
  },
  {
    provider: "minimax",
    displayName: "MiniMax",
    summary: "适合作为平台内补充的重排入口。",
    defaultBaseUrl: "https://api.minimax.chat/v1",
    recommendedModel: "",
    tags: ["RERANK", "CHAT"],
    hint: "模型需手动确认"
  },
  {
    provider: "tencent-hunyuan",
    displayName: "腾讯混元",
    summary: "适合企业环境内统一接入与治理。",
    defaultBaseUrl: "https://api.hunyuan.cloud.tencent.com/v1",
    recommendedModel: "",
    tags: ["RERANK", "COMPATIBLE"],
    hint: "模型需手动确认"
  },
  {
    provider: "tongyi",
    displayName: "通义",
    summary: "DashScope 兼容模式下可直接接入排序模型。",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    recommendedModel: "gte-rerank-v2",
    mode: "compatible",
    tags: ["RERANK", "ALIBABA"],
    hint: "推荐 gte-rerank-v2"
  }
];

export function listRagProviderPresets(
  taskType: RagProviderTaskType
): RagProviderPreset[] {
  return taskType === "embedding" ? EMBEDDING_PRESETS : RERANK_PRESETS;
}

export function resolveRagProviderPreset(
  taskType: RagProviderTaskType,
  provider?: string | null
): RagProviderPreset | null {
  if (!provider) {
    return null;
  }
  return (
    listRagProviderPresets(taskType).find((preset) => preset.provider === provider) ?? null
  );
}

function resolveInitials(displayName: string): string {
  const compact = displayName.replace(/\s+/g, "");
  return compact.slice(0, 2).toUpperCase();
}

export function RagProviderCardGrid({
  taskType,
  activeProvider,
  readonly = false,
  loading = false,
  dirty = false,
  onSelectProvider
}: RagProviderCardGridProps) {
  const presets = listRagProviderPresets(taskType);

  return (
    <section className="space-y-3">
      {readonly ? (
        <StateBlock variant="idle">当前账号只读，可查看已激活 provider 摘要。</StateBlock>
      ) : null}
      <div className="grid gap-3 xl:grid-cols-2">
        {presets.map((preset) => {
          const active = activeProvider?.trim() === preset.provider;
          return (
            <button
              key={`${taskType}-${preset.provider}`}
              type="button"
              aria-label={`${taskType}-preset-${preset.provider}`}
              className={cn(
                "group rounded-2xl border p-4 text-left transition-all duration-200",
                "border-[rgba(148,163,184,0.32)] bg-white/92 shadow-[0_8px_20px_rgba(15,23,42,0.05)]",
                "hover:-translate-y-0.5 hover:border-[rgba(59,130,246,0.42)] hover:shadow-[0_16px_28px_rgba(37,99,235,0.12)]",
                active
                  ? "border-[rgba(59,130,246,0.48)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(239,246,255,0.82)_100%)] shadow-[0_16px_28px_rgba(37,99,235,0.14)]"
                  : "",
                readonly ? "cursor-default opacity-80" : ""
              )}
              disabled={readonly || loading}
              onClick={() => {
                if (readonly || loading) {
                  return;
                }
                if (
                  dirty &&
                  activeProvider?.trim() !== preset.provider &&
                  typeof window !== "undefined" &&
                  !window.confirm("当前有未保存草稿。切换预置将覆盖草稿，是否继续？")
                ) {
                  return;
                }
                onSelectProvider(preset);
              }}
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br text-xs font-bold",
                    PROVIDER_CARD_STYLE[preset.provider]
                  )}
                >
                  {resolveInitials(preset.displayName)}
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="text-base font-semibold text-[var(--text-primary)]">
                          {preset.displayName}
                        </p>
                        {active ? (
                          <Badge variant="outline" className="bg-white text-[10px]">
                            当前配置
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-sm text-[var(--text-secondary)]">{preset.summary}</p>
                    </div>
                    <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-tertiary)] transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[var(--action-primary)]" />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {preset.tags.map((tag) => (
                      <Badge
                        key={`${preset.provider}-${tag}`}
                        variant="outline"
                        className="bg-[var(--surface-subtle)] text-[10px]"
                      >
                        {tag}
                      </Badge>
                    ))}
                    <Badge
                      variant="outline"
                      className="bg-[var(--surface-subtle)] text-[10px]"
                    >
                      {preset.recommendedModel ? "READY_PRESET" : "MANUAL_MODEL"}
                    </Badge>
                    {preset.mode ? (
                      <Badge
                        variant="outline"
                        className="bg-[var(--surface-subtle)] text-[10px]"
                      >
                        {preset.mode.toUpperCase()}
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[rgba(148,163,184,0.22)] pt-3">
                <div className="space-y-0.5">
                  <p className="text-[11px] font-medium text-[var(--text-secondary)]">
                    {preset.recommendedModel
                      ? `推荐模型 · ${preset.recommendedModel}`
                      : "模型默认留空，打开后手动填写"}
                  </p>
                  <p className="text-[11px] text-[var(--text-tertiary)]">{preset.hint}</p>
                </div>
                <Badge variant="outline" className="bg-white text-[10px]">
                  <Sparkles className="h-3 w-3" />
                  点击配置
                </Badge>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
