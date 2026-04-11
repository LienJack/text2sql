"use client";

import Link from "next/link";
import { BarChart3, BookOpen, Database, MessageSquare, Settings, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StateBlock } from "@/components/ui/state-block";
import { cn } from "@/lib/utils";
import { type OverviewStat, fetchOverviewStats } from "@/lib/platform-mock-adapter";

const quickLinks = [
  {
    href: "/chat",
    title: "进入 Chat 工作台",
    description: "进行自然语言问数，查看 SQL 执行与调试链路。",
    icon: MessageSquare
  },
  {
    href: "/data-sources",
    title: "管理数据源",
    description: "配置连接、筛选表字段并维护元数据。",
    icon: Database
  },
  {
    href: "/dashboards",
    title: "查看看板",
    description: "沉淀可复用分析结果并统一共享。",
    icon: BarChart3
  },
  {
    href: "/glossary",
    title: "维护术语库",
    description: "统一业务口径，减少问数歧义。",
    icon: BookOpen
  },
  {
    href: "/prompts",
    title: "管理提示词",
    description: "按场景维护 Prompt 模板与版本。",
    icon: Sparkles
  },
  {
    href: "/settings",
    title: "系统设置",
    description: "管理模型、用户与权限配置。",
    icon: Settings
  }
];

const statStyles: Record<OverviewStat["status"], string> = {
  healthy: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  error: "border-rose-200 bg-rose-50 text-rose-700"
};

export default function OverviewPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<OverviewStat[]>([]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetchOverviewStats();
        if (!active) {
          return;
        }
        setStats(response);
      } catch (loadError) {
        if (!active) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "加载总览信息失败");
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

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6 bg-[var(--surface-page)] p-4 sm:p-6 lg:p-8">
      <section className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-panel)] p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
        <h2 className="text-xl font-semibold text-[var(--text-primary)]">Text2SQL 平台总览</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          当前页面用于展示平台健康态与各模块入口，Chat 模块已连接真实后端接口。
        </p>
      </section>

      {loading ? <StateBlock variant="loading">正在加载平台指标...</StateBlock> : null}
      {error ? <StateBlock variant="error">{error}</StateBlock> : null}

      {!loading && !error ? (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat) => (
            <Card key={stat.id} className={cn("border", statStyles[stat.status])}>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs uppercase tracking-wide text-current/80">
                  {stat.label}
                </CardDescription>
                <CardTitle className="text-2xl text-current">{stat.value}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-current/80">{stat.trend}</CardContent>
            </Card>
          ))}
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {quickLinks.map((link) => {
          const Icon = link.icon;
          return (
            <Link key={link.href} href={link.href} className="group">
              <Card className="h-full border-[var(--border-default)] transition-all group-hover:-translate-y-0.5 group-hover:border-[var(--border-brand)] group-hover:shadow-[0_4px_12px_rgba(15,23,42,0.08)]">
                <CardHeader>
                  <div className="flex items-center gap-2 text-[var(--action-primary-hover)]">
                    <Icon className="h-4 w-4" />
                    <CardTitle className="text-base">{link.title}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="text-sm text-[var(--text-secondary)]">{link.description}</CardContent>
              </Card>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
