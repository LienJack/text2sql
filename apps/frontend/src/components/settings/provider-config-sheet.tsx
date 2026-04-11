"use client";

import { FormEvent, useMemo, useState } from "react";
import type { LlmProviderCode } from "@text2sql/shared-types";
import { ChevronDown, PackagePlus } from "lucide-react";
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
import { StateBlock } from "@/components/ui/state-block";
import { cn } from "@/lib/utils";

type SupportedProvider = {
  provider: LlmProviderCode;
  displayName: string;
  defaultBaseUrl: string;
  supportsModelListing: boolean;
};

interface ProviderConfigSheetProps {
  loading?: boolean;
  supportedProviders: SupportedProvider[];
  installedProviderCodes: LlmProviderCode[];
  onCreateProvider: (payload: {
    provider: LlmProviderCode;
    displayName?: string;
    baseUrl?: string;
    apiKey?: string;
    enabled?: boolean;
  }) => Promise<void>;
}

const PROVIDER_COPY: Record<
  LlmProviderCode,
  {
    summary: string;
    tags: string[];
  }
> = {
  openai: {
    summary: "OpenAI 提供通用对话与推理模型。",
    tags: ["LLM", "CHAT"]
  },
  gemini: {
    summary: "Google Gemini 系列模型，适合多模态与长上下文场景。",
    tags: ["LLM", "MULTIMODAL"]
  },
  deepseek: {
    summary: "DeepSeek 推理模型，适合代码与复杂推理任务。",
    tags: ["LLM", "REASONING"]
  },
  kimi: {
    summary: "Kimi 长上下文模型，适合复杂问答与知识检索。",
    tags: ["LLM", "LONG_CTX"]
  },
  volcengine: {
    summary: "火山方舟模型服务，支持企业级模型接入。",
    tags: ["LLM", "ENTERPRISE"]
  },
  siliconflow: {
    summary: "硅基流动聚合模型平台，模型覆盖广。",
    tags: ["LLM", "AGGREGATOR"]
  },
  openrouter: {
    summary: "OpenRouter 聚合多家模型，便于统一切换。",
    tags: ["LLM", "ROUTER"]
  },
  minimax: {
    summary: "MiniMax 模型平台，适合对话与创作场景。",
    tags: ["LLM", "CHAT"]
  },
  "tencent-hunyuan": {
    summary: "腾讯混元模型服务，支持 OpenAI 兼容接入。",
    tags: ["LLM", "COMPATIBLE"]
  },
  tongyi: {
    summary: "阿里通义模型服务（DashScope 兼容模式）。",
    tags: ["LLM", "COMPATIBLE"]
  }
};

export function ProviderConfigSheet({
  loading,
  supportedProviders,
  installedProviderCodes,
  onCreateProvider
}: ProviderConfigSheetProps) {
  const [provider, setProvider] = useState<LlmProviderCode>("openai");
  const [displayName, setDisplayName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [installSectionOpen, setInstallSectionOpen] = useState(true);

  const installableProviders = useMemo(() => {
    const installed = new Set(installedProviderCodes);
    return supportedProviders.filter((item) => !installed.has(item.provider));
  }, [installedProviderCodes, supportedProviders]);

  const selected = useMemo(
    () => installableProviders.find((item) => item.provider === provider),
    [installableProviders, provider]
  );

  const chooseProvider = (nextProvider: LlmProviderCode): void => {
    setProvider(nextProvider);
    const match = installableProviders.find((item) => item.provider === nextProvider);
    if (match) {
      setBaseUrl(match.defaultBaseUrl);
      setDisplayName(match.displayName);
    }
    setApiKey("");
    setDialogOpen(true);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await onCreateProvider({
        provider,
        displayName: displayName.trim() || undefined,
        baseUrl: baseUrl.trim() || selected?.defaultBaseUrl,
        apiKey: apiKey.trim() || undefined,
        enabled: true
      });
      setDisplayName("");
      setApiKey("");
      setBaseUrl(selected?.defaultBaseUrl ?? "");
      setDialogOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Collapsible
      open={installSectionOpen}
      onOpenChange={setInstallSectionOpen}
      className="group/install rounded-lg border border-slate-200 bg-white p-4"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between rounded-md px-1 py-1 text-left"
        >
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
              <PackagePlus className="h-4 w-4 text-teal-600" />
              安装模型供应商
            </div>
            <p className="text-xs text-slate-500">点击厂商卡片，弹出配置窗口后保存并同步模型。</p>
          </div>
          <ChevronDown className="h-4 w-4 text-slate-500 transition-transform group-data-[state=open]/install:rotate-180" />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent className="pt-3">
        {installableProviders.length === 0 ? (
          <StateBlock variant="idle">所有支持厂商都已安装，可在上方进行模型治理。</StateBlock>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {installableProviders.map((item) => {
          const copy = PROVIDER_COPY[item.provider];
          return (
            <button
              key={item.provider}
              type="button"
              className={cn(
                "group rounded-xl border p-3 text-left transition-all",
                "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
              )}
              disabled={loading || submitting}
              onClick={() => chooseProvider(item.provider)}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-xs font-bold text-white">
                  {item.displayName.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-slate-900">{item.displayName}</p>
                  </div>
                  <p className="line-clamp-2 text-xs text-slate-600">{copy.summary}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {copy.tags.map((tag) => (
                      <Badge key={`${item.provider}-${tag}`} variant="outline" className="text-[10px]">
                        {tag}
                      </Badge>
                    ))}
                    {item.supportsModelListing ? (
                      <Badge variant="outline" className="text-[10px]">
                        AUTO_SYNC
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </div>
            </button>
          );
            })}
          </div>
        )}
      </CollapsibleContent>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <form className="space-y-4" onSubmit={onSubmit}>
            <DialogHeader>
              <DialogTitle>配置厂商：{selected?.displayName ?? provider}</DialogTitle>
              <DialogDescription>
                填写连接信息后保存，系统将自动同步该厂商可用模型。
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5">
              <Label htmlFor="provider-display-name">显示名称</Label>
              <Input
                id="provider-display-name"
                value={displayName}
                placeholder={selected?.displayName ?? "厂商显示名称"}
                disabled={loading || submitting}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="provider-base-url">Base URL</Label>
              <Input
                id="provider-base-url"
                value={baseUrl}
                placeholder={selected?.defaultBaseUrl}
                disabled={loading || submitting}
                onChange={(event) => setBaseUrl(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="provider-api-key">API Key</Label>
              <Input
                id="provider-api-key"
                type="password"
                value={apiKey}
                placeholder="输入厂商 API Key"
                disabled={loading || submitting}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </div>

            <DialogFooter showCloseButton>
              <Button type="submit" disabled={loading || submitting || !provider}>
                保存并同步模型
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Collapsible>
  );
}
