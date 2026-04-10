"use client";

import { Code2, LineChart, Plus, Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StateBlock } from "@/components/ui/state-block";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { type PromptTemplate, fetchPromptTemplates } from "@/lib/platform-mock-adapter";

type SceneFilter = "all" | "sql" | "analysis";

export default function PromptsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [scene, setScene] = useState<SceneFilter>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const data = await fetchPromptTemplates();
        if (!active) {
          return;
        }
        setTemplates(data);
      } catch (loadError) {
        if (!active) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "加载提示词模板失败");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  const filteredTemplates = useMemo(() => {
    const byScene =
      scene === "all" ? templates : templates.filter((template) => template.scene === scene);
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return byScene;
    }
    return byScene.filter((template) =>
      `${template.name} ${template.scope} ${template.version}`.toLowerCase().includes(keyword)
    );
  }, [query, scene, templates]);

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] w-full max-w-[1400px] flex-col gap-4 p-4 sm:p-6">
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex sm:items-center sm:justify-between sm:space-y-0">
        <div>
          <h2 className="inline-flex items-center gap-2 text-lg font-semibold text-slate-900">
            <Sparkles className="h-5 w-5 text-amber-500" />
            自定义提示词模板
          </h2>
          <p className="text-sm text-slate-500">按场景维护 Prompt 模板并进行版本化管理。</p>
        </div>
        <Button className="bg-slate-900 text-white hover:bg-slate-800">
          <Plus className="h-4 w-4" />
          新增模板
        </Button>
      </section>

      <section className="flex min-h-0 flex-1 flex-col overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="space-y-3 border-b border-slate-200 p-4 sm:flex sm:items-center sm:justify-between sm:space-y-0">
          <Tabs
            value={scene}
            onValueChange={(value) => setScene(value as SceneFilter)}
            className="w-full sm:w-auto"
          >
            <TabsList className="h-10">
              <TabsTrigger value="all">全部场景</TabsTrigger>
              <TabsTrigger value="sql">
                <Code2 className="h-3.5 w-3.5" />
                生成 SQL
              </TabsTrigger>
              <TabsTrigger value="analysis">
                <LineChart className="h-3.5 w-3.5" />
                分析总结
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-9"
              placeholder="搜索模板名称..."
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? <StateBlock variant="loading" className="m-4">正在加载模板...</StateBlock> : null}
          {error ? <StateBlock variant="error" className="m-4">{error}</StateBlock> : null}
          {!loading && !error && filteredTemplates.length === 0 ? (
            <StateBlock variant="idle" className="m-4">当前筛选条件下暂无模板。</StateBlock>
          ) : null}

          {!loading && !error && filteredTemplates.length > 0 ? (
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="w-[260px]">模板名称</TableHead>
                  <TableHead className="w-[120px]">场景</TableHead>
                  <TableHead className="w-[160px]">作用范围</TableHead>
                  <TableHead className="w-[120px]">版本</TableHead>
                  <TableHead className="w-[120px]">状态</TableHead>
                  <TableHead className="w-[160px]">更新时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTemplates.map((template) => (
                  <TableRow key={template.id}>
                    <TableCell className="font-medium text-slate-900">{template.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {template.scene === "sql" ? "生成 SQL" : "分析总结"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-slate-600">{template.scope}</TableCell>
                    <TableCell className="font-mono text-sm text-slate-700">{template.version}</TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "text-sm font-medium",
                          template.status === "active" ? "text-emerald-600" : "text-slate-500"
                        )}
                      >
                        {template.status === "active" ? "生效中" : "草稿"}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-slate-500">{template.updatedAt}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </div>
      </section>
    </div>
  );
}
