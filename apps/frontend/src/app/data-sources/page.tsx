"use client";

import { AlertTriangle, Database, Hash, KeyRound, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StateBlock } from "@/components/ui/state-block";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { type DataSourceConnection, type DataSourcesView, fetchDataSourcesView } from "@/lib/platform-mock-adapter";

const connectionStatusText: Record<DataSourceConnection["status"], string> = {
  healthy: "已连接",
  warning: "待关注",
  error: "连接异常"
};

export default function DataSourcesPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<DataSourcesView | null>(null);
  const [connectionQuery, setConnectionQuery] = useState("");
  const [tableQuery, setTableQuery] = useState("");
  const [activeConnectionId, setActiveConnectionId] = useState("");
  const [activeTableId, setActiveTableId] = useState("");

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetchDataSourcesView();
        if (!active) {
          return;
        }
        setView(response);
        setActiveConnectionId(response.connections[0]?.id ?? "");
        setActiveTableId(response.tablesByConnection[response.connections[0]?.id ?? ""]?.[0]?.id ?? "");
      } catch (loadError) {
        if (!active) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "加载数据源信息失败");
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

  const filteredConnections = useMemo(() => {
    if (!view) {
      return [];
    }
    const keyword = connectionQuery.trim().toLowerCase();
    if (!keyword) {
      return view.connections;
    }
    return view.connections.filter((connection) =>
      `${connection.name} ${connection.engine}`.toLowerCase().includes(keyword)
    );
  }, [connectionQuery, view]);

  const activeConnection = useMemo(
    () => filteredConnections.find((connection) => connection.id === activeConnectionId) ?? filteredConnections[0],
    [activeConnectionId, filteredConnections]
  );

  const tables = useMemo(() => {
    if (!view || !activeConnection) {
      return [];
    }
    const rows = view.tablesByConnection[activeConnection.id] ?? [];
    const keyword = tableQuery.trim().toLowerCase();
    if (!keyword) {
      return rows;
    }
    return rows.filter((table) =>
      `${table.name} ${table.description}`.toLowerCase().includes(keyword)
    );
  }, [activeConnection, tableQuery, view]);

  const activeTable = useMemo(
    () => tables.find((table) => table.id === activeTableId) ?? tables[0],
    [activeTableId, tables]
  );

  const toggleTableEnabled = (tableId: string, checked: boolean) => {
    setView((previous) => {
      if (!previous || !activeConnection) {
        return previous;
      }
      const nextTables = (previous.tablesByConnection[activeConnection.id] ?? []).map((table) =>
        table.id === tableId ? { ...table, enabled: checked } : table
      );
      return {
        ...previous,
        tablesByConnection: {
          ...previous.tablesByConnection,
          [activeConnection.id]: nextTables
        }
      };
    });
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-[640px] overflow-hidden bg-[var(--surface-page)]">
      <aside className="hidden w-72 border-r border-[var(--border-default)] bg-[var(--surface-sidebar)] md:flex md:flex-col">
        <div className="space-y-3 border-b border-[var(--border-default)] p-4">
          <Button className="w-full justify-start">
            <Database className="h-4 w-4" />
            添加数据源
          </Button>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--text-tertiary)]" />
            <Input
              value={connectionQuery}
              onChange={(event) => setConnectionQuery(event.target.value)}
              placeholder="搜索连接..."
              className="pl-9"
            />
          </div>
        </div>
        <ScrollArea className="flex-1">
          <div className="space-y-2 p-3">
            {filteredConnections.map((connection) => {
              const active = connection.id === activeConnection?.id;
              return (
                <button
                  key={connection.id}
                  type="button"
                  onClick={() => {
                    setActiveConnectionId(connection.id);
                    setActiveTableId((view?.tablesByConnection[connection.id] ?? [])[0]?.id ?? "");
                  }}
                  className={cn(
                    "w-full rounded-lg border px-3 py-3 text-left transition-colors",
                    active
                      ? "border-[var(--border-brand)] bg-[var(--surface-active)]"
                      : "border-transparent bg-transparent hover:border-[var(--border-default)] hover:bg-[var(--surface-hover)]"
                  )}
                >
                  <p className="truncate text-sm font-medium text-[var(--text-primary)]">{connection.name}</p>
                  <div className="mt-2 flex items-center justify-between text-xs text-[var(--text-tertiary)]">
                    <span>{connection.engine}</span>
                    <span
                      className={cn(
                        "font-medium",
                        connection.status === "healthy"
                          ? "text-emerald-600"
                          : connection.status === "warning"
                            ? "text-amber-600"
                            : "text-rose-600"
                      )}
                    >
                      {connectionStatusText[connection.status]}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col border-r border-[var(--border-default)]">
        <div className="space-y-3 border-b border-[var(--border-default)] bg-[var(--surface-panel)] p-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              {activeConnection?.name ?? "数据源"}
            </h2>
            <p className="text-sm text-[var(--text-secondary)]">
              最近同步：{activeConnection?.lastSync ?? "-"}
            </p>
          </div>
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--text-tertiary)]" />
            <Input
              value={tableQuery}
              onChange={(event) => setTableQuery(event.target.value)}
              placeholder="搜索表名或注释..."
              className="pl-9"
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {loading ? <StateBlock variant="loading">正在加载数据源信息...</StateBlock> : null}
          {error ? <StateBlock variant="error">{error}</StateBlock> : null}
          {!loading && !error && tables.length === 0 ? (
            <StateBlock variant="idle">当前数据源暂无可展示数据表。</StateBlock>
          ) : null}

          {!loading && !error && tables.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-panel)]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[220px]">表名</TableHead>
                    <TableHead>说明</TableHead>
                    <TableHead className="w-[120px] text-center">字段数</TableHead>
                    <TableHead className="w-[120px] text-center">问数可见</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tables.map((table) => (
                    <TableRow
                      key={table.id}
                      className={cn("cursor-pointer", table.id === activeTable?.id ? "bg-[var(--surface-active)]" : "")}
                      onClick={() => setActiveTableId(table.id)}
                    >
                      <TableCell className="font-mono text-sm font-medium">
                        {table.name}
                      </TableCell>
                      <TableCell className="text-sm text-[var(--text-secondary)]">{table.description}</TableCell>
                      <TableCell className="text-center text-sm text-[var(--text-tertiary)]">{table.fieldCount}</TableCell>
                      <TableCell className="text-center">
                        <div onClick={(event) => event.stopPropagation()}>
                          <Switch
                            checked={table.enabled}
                            onCheckedChange={(checked) => toggleTableEnabled(table.id, checked)}
                            aria-label={`切换 ${table.name} 可见性`}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </div>
      </section>

      <aside className="hidden w-96 flex-col bg-[var(--surface-sidebar)] lg:flex">
        <div className="border-b border-[var(--border-default)] p-4">
          <h3 className="font-mono text-lg font-semibold text-[var(--text-primary)]">{activeTable?.name ?? "-"}</h3>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">{activeTable?.description ?? "请选择数据表查看字段。"}</p>
        </div>
        <ScrollArea className="flex-1">
          <div className="space-y-3 p-4">
            {(activeTable?.fields ?? []).map((field) => (
              <article key={field.id} className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-panel)] p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {field.mode === "metric" ? (
                      <Hash className="h-4 w-4 text-[var(--action-primary)]" />
                    ) : field.mode === "sensitive" ? (
                      <AlertTriangle className="h-4 w-4 text-rose-500" />
                    ) : (
                      <KeyRound className="h-4 w-4 text-amber-500" />
                    )}
                    <span className="font-mono text-sm font-semibold text-[var(--text-primary)]">{field.name}</span>
                  </div>
                  <Badge variant="secondary" className="font-mono text-[11px]">
                    {field.type}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-[var(--text-secondary)]">{field.description}</p>
                <div className="mt-3 flex items-center justify-between border-t border-[var(--border-subtle)] pt-2 text-xs">
                  <span className="text-[var(--text-tertiary)]">
                    {field.mode === "metric"
                      ? "度量字段"
                      : field.mode === "sensitive"
                        ? "敏感字段"
                        : "维度字段"}
                  </span>
                  <span className={cn("font-medium", field.enabled ? "text-[var(--action-primary-hover)]" : "text-[var(--text-tertiary)]")}>
                    {field.enabled ? "参与问数" : "不参与问数"}
                  </span>
                </div>
              </article>
            ))}
            {!activeTable ? (
              <StateBlock variant="idle">请先从中间表格选择一个数据表。</StateBlock>
            ) : null}
          </div>
        </ScrollArea>
      </aside>
    </div>
  );
}
