"use client";

import { Search, Settings2, Shield, Users } from "lucide-react";
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
import { type LlmModelConfig, type PlatformSettingsView, type PlatformUser, fetchSettingsView } from "@/lib/platform-mock-adapter";

type SettingsTab = "models" | "users";

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<SettingsTab>("models");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<PlatformSettingsView | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetchSettingsView();
        if (!active) {
          return;
        }
        setView(response);
      } catch (loadError) {
        if (!active) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "加载设置数据失败");
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

  const modelRows = useMemo(() => {
    const rows = view?.models ?? [];
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return rows;
    }
    return rows.filter((row) =>
      `${row.alias} ${row.provider} ${row.model}`.toLowerCase().includes(keyword)
    );
  }, [query, view?.models]);

  const userRows = useMemo(() => {
    const rows = view?.users ?? [];
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return rows;
    }
    return rows.filter((row) =>
      `${row.name} ${row.email} ${row.role} ${row.department}`.toLowerCase().includes(keyword)
    );
  }, [query, view?.users]);

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] w-full max-w-[1400px] flex-col gap-4 p-4 sm:p-6">
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex sm:items-center sm:justify-between sm:space-y-0">
        <Tabs value={tab} onValueChange={(value) => setTab(value as SettingsTab)} className="w-full sm:w-auto">
          <TabsList className="h-10">
            <TabsTrigger value="models">
              <Settings2 className="h-3.5 w-3.5" />
              LLM 模型
            </TabsTrigger>
            <TabsTrigger value="users">
              <Users className="h-3.5 w-3.5" />
              用户与权限
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-9"
              placeholder={tab === "models" ? "搜索模型..." : "搜索用户..."}
            />
          </div>
          <Button className="bg-slate-900 text-white hover:bg-slate-800">
            {tab === "models" ? "添加模型" : "添加用户"}
          </Button>
        </div>
      </section>

      <section className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        {loading ? <StateBlock variant="loading" className="m-4">正在加载设置数据...</StateBlock> : null}
        {error ? <StateBlock variant="error" className="m-4">{error}</StateBlock> : null}
        {!loading && !error ? (
          tab === "models" ? (
            <ModelsTable rows={modelRows} />
          ) : (
            <UsersTable rows={userRows} />
          )
        ) : null}
      </section>
    </div>
  );
}

function ModelsTable({ rows }: { rows: LlmModelConfig[] }) {
  if (rows.length === 0) {
    return <StateBlock variant="idle" className="m-4">暂无可展示模型配置。</StateBlock>;
  }

  return (
    <Table>
      <TableHeader className="bg-slate-50">
        <TableRow>
          <TableHead className="w-[220px]">模型别名</TableHead>
          <TableHead>提供商 / 模型名</TableHead>
          <TableHead className="w-[140px]">状态</TableHead>
          <TableHead className="w-[160px]">更新时间</TableHead>
          <TableHead className="w-[120px] text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((model) => (
          <TableRow key={model.id}>
            <TableCell>
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-900">{model.alias}</span>
                {model.default ? <Badge className="bg-teal-600 text-white">默认</Badge> : null}
              </div>
            </TableCell>
            <TableCell>
              <p className="text-sm font-medium text-slate-700">{model.provider}</p>
              <p className="font-mono text-xs text-slate-500">{model.model}</p>
            </TableCell>
            <TableCell>
              <span
                className={cn(
                  "text-sm font-medium",
                  model.status === "healthy"
                    ? "text-emerald-600"
                    : model.status === "warning"
                      ? "text-amber-600"
                      : "text-rose-600"
                )}
              >
                {model.status === "healthy" ? "连通正常" : model.status === "warning" ? "待关注" : "连接失败"}
              </span>
            </TableCell>
            <TableCell className="text-sm text-slate-500">{model.updatedAt}</TableCell>
            <TableCell className="text-right">
              <Button variant="outline" size="sm">
                检测连通性
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function UsersTable({ rows }: { rows: PlatformUser[] }) {
  if (rows.length === 0) {
    return <StateBlock variant="idle" className="m-4">暂无可展示用户数据。</StateBlock>;
  }

  return (
    <Table>
      <TableHeader className="bg-slate-50">
        <TableRow>
          <TableHead className="w-[260px]">用户</TableHead>
          <TableHead className="w-[160px]">角色</TableHead>
          <TableHead className="w-[140px]">部门</TableHead>
          <TableHead className="w-[140px]">状态</TableHead>
          <TableHead className="w-[180px]">最近登录</TableHead>
          <TableHead className="w-[140px] text-right">权限操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((user) => (
          <TableRow key={user.id}>
            <TableCell>
              <p className="font-medium text-slate-900">{user.name}</p>
              <p className="text-xs text-slate-500">{user.email}</p>
            </TableCell>
            <TableCell>
              <Badge variant={user.role === "系统管理员" ? "default" : "secondary"}>
                {user.role}
              </Badge>
            </TableCell>
            <TableCell className="text-sm text-slate-600">{user.department}</TableCell>
            <TableCell>
              <span className={cn("text-sm font-medium", user.status === "active" ? "text-emerald-600" : "text-slate-500")}>
                {user.status === "active" ? "正常" : "停用"}
              </span>
            </TableCell>
            <TableCell className="text-sm text-slate-500">{user.lastLogin}</TableCell>
            <TableCell className="text-right">
              <Button variant="ghost" size="sm" className="text-teal-700 hover:text-teal-800">
                <Shield className="h-3.5 w-3.5" />
                编辑权限
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
