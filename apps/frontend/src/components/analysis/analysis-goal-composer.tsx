"use client";

import type { AnalysisGoalContract } from "@text2sql/shared-types";
import { useState } from "react";
import { ArrowRight, Target, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

const DEFAULT_BUDGET: AnalysisGoalContract["budget"] = {
  maxDurationMs: 900_000,
  maxTokenCount: 80_000,
  maxQueryCount: 30,
  maxSearchCount: 20,
  maxArtifactBytes: 20_000_000
};

export function AnalysisGoalComposer({
  workspaceId,
  onCancel,
  onCreate,
  busy
}: {
  workspaceId: string;
  onCancel: () => void;
  onCreate: (goal: AnalysisGoalContract) => Promise<void>;
  busy: boolean;
}) {
  const [objective, setObjective] = useState("");
  const [decisionUse, setDecisionUse] = useState("");
  const [datasourceIds, setDatasourceIds] = useState("");
  const [deliverables, setDeliverables] = useState("结论摘要\n关键证据\n风险与限制");
  const [riskLevel, setRiskLevel] = useState<AnalysisGoalContract["riskLevel"]>("medium");

  const canSubmit = Boolean(workspaceId && objective.trim() && decisionUse.trim());

  return (
    <div className="min-h-full bg-[#ede8dc] p-4 sm:p-7">
      <Card className="mx-auto max-w-3xl rounded-none border border-stone-300 bg-[#fffdf7] py-0 shadow-[0_18px_60px_rgba(68,58,38,0.12)] ring-0">
        <CardHeader className="border-b border-stone-200 px-5 py-5 sm:px-8 sm:py-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="mb-3 flex size-9 items-center justify-center rounded-full bg-blue-950 text-white">
                <Target className="size-4" aria-hidden="true" />
              </div>
              <CardTitle className="font-serif text-2xl font-semibold tracking-tight text-stone-950">
                定义一份可审计的分析委托
              </CardTitle>
              <CardDescription className="mt-2 max-w-xl text-stone-600">
                目标、决策用途和预算会固化为 Goal Contract。后续修订不会覆盖历史版本。
              </CardDescription>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={onCancel} aria-label="关闭新建任务">
              <X aria-hidden="true" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 px-5 py-6 sm:px-8 sm:py-8">
          <div className="space-y-2">
            <Label htmlFor="analysis-objective">分析目标</Label>
            <Textarea
              id="analysis-objective"
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              placeholder="例如：分析过去 90 天订单取消率上升的主要原因，并识别可行动的改善机会。"
              className="min-h-24 bg-white"
            />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="analysis-decision-use">决策用途</Label>
              <Input
                id="analysis-decision-use"
                value={decisionUse}
                onChange={(event) => setDecisionUse(event.target.value)}
                placeholder="用于下季度履约策略评审"
                className="bg-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="analysis-risk-level">风险级别</Label>
              <NativeSelect
                id="analysis-risk-level"
                className="w-full"
                value={riskLevel}
                onChange={(event) => setRiskLevel(event.target.value as AnalysisGoalContract["riskLevel"])}
              >
                <NativeSelectOption value="low">低风险</NativeSelectOption>
                <NativeSelectOption value="medium">中风险</NativeSelectOption>
                <NativeSelectOption value="high">高风险</NativeSelectOption>
              </NativeSelect>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="analysis-datasources">数据源 ID（逗号分隔，可选）</Label>
            <Input
              id="analysis-datasources"
              value={datasourceIds}
              onChange={(event) => setDatasourceIds(event.target.value)}
              placeholder="datasource-a, datasource-b"
              className="bg-white font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="analysis-deliverables">交付物（每行一项）</Label>
            <Textarea
              id="analysis-deliverables"
              value={deliverables}
              onChange={(event) => setDeliverables(event.target.value)}
              className="min-h-24 bg-white"
            />
          </div>
          <div className="flex flex-col-reverse gap-2 border-t border-stone-200 pt-5 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={onCancel}>取消</Button>
            <Button
              disabled={!canSubmit || busy}
              onClick={() =>
                void onCreate({
                  version: "analysis-goal.v1",
                  objective: objective.trim(),
                  decisionUse: decisionUse.trim(),
                  workspaceId,
                  datasourceIds: datasourceIds.split(",").map((item) => item.trim()).filter(Boolean),
                  allowedSourceKinds: ["datasource", "governed_web", "knowledge_asset"],
                  deliverables: deliverables.split("\n").map((item) => item.trim()).filter(Boolean),
                  budget: DEFAULT_BUDGET,
                  riskLevel,
                  stopConditions: ["budget_exhausted", "mandatory_evidence_unavailable", "authority_revoked"]
                })
              }
            >
              {busy ? "正在创建…" : "创建分析任务"}
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
