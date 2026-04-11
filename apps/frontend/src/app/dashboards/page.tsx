"use client";

import { BarChart3, LayoutDashboard, PieChart, Plus, Search, Star } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StateBlock } from "@/components/ui/state-block";
import { cn } from "@/lib/utils";
import { type DashboardCard, fetchDashboards } from "@/lib/platform-mock-adapter";

type FolderKey = "mine" | "team";

const chartIcons = {
  line: LayoutDashboard,
  bar: BarChart3,
  pie: PieChart
} as const;

export default function DashboardsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dashboards, setDashboards] = useState<DashboardCard[]>([]);
  const [folder, setFolder] = useState<FolderKey>("mine");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const data = await fetchDashboards();
        if (!active) {
          return;
        }
        setDashboards(data);
      } catch (loadError) {
        if (!active) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "加载看板失败");
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

  const filteredDashboards = useMemo(() => {
    const source = dashboards.filter((dashboard) =>
      folder === "mine" ? dashboard.owner === "我" : dashboard.owner !== "我"
    );
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return source;
    }
    return source.filter((dashboard) =>
      `${dashboard.title} ${dashboard.owner}`.toLowerCase().includes(keyword)
    );
  }, [dashboards, folder, query]);

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-[640px] overflow-hidden bg-[var(--surface-page)]">
      <aside className="hidden w-64 flex-col border-r border-[var(--border-default)] bg-[var(--surface-panel)] md:flex">
        <div className="border-b border-[var(--border-default)] p-4">
          <Button className="w-full justify-start">
            <Plus className="h-4 w-4" />
            新建看板
          </Button>
        </div>
        <nav className="space-y-1 p-3">
          <button
            type="button"
            className={cn(
              "flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm font-medium",
              folder === "mine"
                ? "border-[var(--border-brand)] bg-[var(--surface-active)] text-[var(--action-primary-hover)]"
                : "border-transparent text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:bg-[var(--surface-hover)]"
            )}
            onClick={() => setFolder("mine")}
          >
            <span>我的看板</span>
            <span className="text-xs text-[var(--text-tertiary)]">{dashboards.filter((item) => item.owner === "我").length}</span>
          </button>
          <button
            type="button"
            className={cn(
              "flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm font-medium",
              folder === "team"
                ? "border-[var(--border-brand)] bg-[var(--surface-active)] text-[var(--action-primary-hover)]"
                : "border-transparent text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:bg-[var(--surface-hover)]"
            )}
            onClick={() => setFolder("team")}
          >
            <span>团队看板</span>
            <span className="text-xs text-[var(--text-tertiary)]">{dashboards.filter((item) => item.owner !== "我").length}</span>
          </button>
        </nav>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="space-y-3 border-b border-[var(--border-default)] bg-[var(--surface-panel)] p-4 sm:flex sm:items-center sm:justify-between sm:space-y-0">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              {folder === "mine" ? "我的看板" : "团队看板"}
            </h2>
            <p className="text-sm text-[var(--text-secondary)]">沉淀并复用稳定的数据分析结果。</p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--text-tertiary)]" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-9"
              placeholder="搜索看板..."
            />
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {loading ? <StateBlock variant="loading">正在加载看板...</StateBlock> : null}
            {error ? <StateBlock variant="error">{error}</StateBlock> : null}
            {!loading && !error && filteredDashboards.length === 0 ? (
              <StateBlock variant="idle">当前分组暂无看板。</StateBlock>
            ) : null}

            {!loading && !error
              ? filteredDashboards.map((dashboard) => {
                  const ChartIcon = chartIcons[dashboard.chartType];
                  return (
                    <Card
                      key={dashboard.id}
                      className="border-[var(--border-default)] transition-all hover:-translate-y-0.5 hover:border-[var(--border-brand)] hover:shadow-[0_4px_12px_rgba(15,23,42,0.08)]"
                    >
                      <CardHeader className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Badge
                            variant={dashboard.status === "published" ? "default" : "secondary"}
                            className={cn(
                              "font-medium",
                              dashboard.status === "published"
                                ? "bg-primary text-primary-foreground"
                                : "bg-[var(--surface-subtle)] text-[var(--text-secondary)]"
                            )}
                          >
                            {dashboard.status === "published" ? "已发布" : "草稿"}
                          </Badge>
                          <span className="text-xs text-[var(--text-tertiary)]">{dashboard.owner}</span>
                        </div>
                        <CardTitle className="text-base text-[var(--text-primary)]">{dashboard.title}</CardTitle>
                      </CardHeader>
                      <CardContent className="flex h-24 items-center justify-center rounded-md border border-dashed border-[var(--border-default)] bg-[var(--surface-subtle)] text-[var(--text-secondary)]">
                        <ChartIcon className="mr-2 h-4 w-4 text-[var(--action-primary)]" />
                        图表预览区域
                      </CardContent>
                      <CardFooter className="mt-3 flex items-center justify-between text-xs text-[var(--text-tertiary)]">
                        <span>更新于 {dashboard.updatedAt}</span>
                        <span className="inline-flex items-center gap-1">
                          <Star className="h-3 w-3" />
                          {dashboard.views}
                        </span>
                      </CardFooter>
                    </Card>
                  );
                })
              : null}

            {!loading && !error ? (
              <button
                type="button"
                className="flex h-[240px] flex-col items-center justify-center rounded-xl border-2 border-dashed border-[var(--border-default)] bg-[var(--surface-panel)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-brand)] hover:text-[var(--action-primary-hover)]"
              >
                <Plus className="mb-2 h-6 w-6" />
                <span className="text-sm font-medium">新建空白看板</span>
                <span className="mt-1 text-xs">从数据源中添加图表组件</span>
              </button>
            ) : null}
          </div>
        </ScrollArea>
      </section>
    </div>
  );
}
