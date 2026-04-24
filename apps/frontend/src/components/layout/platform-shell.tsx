"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  BookOpen,
  Database,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Settings,
  Sparkles,
  User,
  Workflow,
  X
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { StateBlock } from "@/components/ui/state-block";
import { type WorkspaceSummary, listWorkspaces } from "@/lib/admin-api-client";
import {
  readActiveWorkspaceId,
  writeActiveWorkspaceId
} from "@/lib/datasource-session-context";
import { cn } from "@/lib/utils";

interface PlatformShellProps {
  children: ReactNode;
}

const navItems = [
  { href: "/", label: "总览", icon: LayoutDashboard },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/data-sources", label: "数据源", icon: Database },
  { href: "/modeling", label: "数据关系图", icon: Workflow },
  { href: "/dashboards", label: "看板", icon: LayoutDashboard },
  { href: "/glossary", label: "术语库", icon: BookOpen },
  { href: "/prompts", label: "提示词", icon: Sparkles },
  { href: "/settings", label: "系统设置", icon: Settings }
];

type WorkspaceGateStatus = "checking" | "ready" | "selecting" | "error";

function readWorkspaceIdFromQuery(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return new URLSearchParams(window.location.search).get("workspaceId")?.trim() ?? "";
}

function syncWorkspaceIdToQuery(workspaceId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const next = new URL(window.location.href);
  if (workspaceId) {
    next.searchParams.set("workspaceId", workspaceId);
  } else {
    next.searchParams.delete("workspaceId");
  }
  const nextPath = `${next.pathname}${next.search}${next.hash}`;
  if (nextPath !== current) {
    window.history.replaceState({}, "", nextPath);
  }
}

function resolveWorkspaceId(
  workspaces: WorkspaceSummary[],
  candidates: string[]
): string {
  const normalizedCandidates = candidates
    .map((item) => item.trim())
    .filter(Boolean);
  for (const candidate of normalizedCandidates) {
    if (workspaces.some((workspace) => workspace.id === candidate)) {
      return candidate;
    }
  }
  return "";
}

function isNavActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function resolveActiveNavHref(pathname: string): string {
  const matchedNavItem = navItems
    .filter((item) => isNavActive(pathname, item.href))
    .sort((left, right) => right.href.length - left.href.length)[0];
  return matchedNavItem?.href ?? "";
}

export function PlatformShell({ children }: PlatformShellProps) {
  const pathname = usePathname();
  const activeNavHref = useMemo(() => resolveActiveNavHref(pathname), [pathname]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [workspaceGateStatus, setWorkspaceGateStatus] =
    useState<WorkspaceGateStatus>("checking");
  const [workspaceGateError, setWorkspaceGateError] = useState("");
  const [workspaceOptions, setWorkspaceOptions] = useState<WorkspaceSummary[]>([]);
  const [workspaceSelection, setWorkspaceSelection] = useState("");

  const title = useMemo(() => {
    const activeItem = navItems.find((item) => item.href === activeNavHref);
    return activeItem?.label ?? "工作台";
  }, [activeNavHref]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const applyWorkspaceSelection = useCallback((workspaceId: string): void => {
    if (!workspaceId.trim()) {
      return;
    }
    writeActiveWorkspaceId(workspaceId);
    syncWorkspaceIdToQuery(workspaceId);
    setWorkspaceSelection(workspaceId);
    setWorkspaceGateStatus("ready");
    setWorkspaceGateError("");
  }, []);

  const ensureWorkspaceContext = useCallback(async (): Promise<void> => {
    setWorkspaceGateStatus("checking");
    setWorkspaceGateError("");
    try {
      const result = await listWorkspaces({ page: 1, pageSize: 200 });
      setWorkspaceOptions(result.items);
      if (result.items.length === 0) {
        writeActiveWorkspaceId("");
        syncWorkspaceIdToQuery("");
        setWorkspaceSelection("");
        setWorkspaceGateStatus("ready");
        return;
      }

      const resolvedWorkspaceId = resolveWorkspaceId(result.items, [
        readWorkspaceIdFromQuery(),
        readActiveWorkspaceId()
      ]);
      if (resolvedWorkspaceId) {
        applyWorkspaceSelection(resolvedWorkspaceId);
        return;
      }

      if (result.items.length === 1) {
        applyWorkspaceSelection(result.items[0].id);
        return;
      }

      setWorkspaceSelection(result.items[0]?.id ?? "");
      setWorkspaceGateStatus("selecting");
    } catch (error) {
      const fallbackWorkspaceId = readActiveWorkspaceId();
      if (fallbackWorkspaceId) {
        applyWorkspaceSelection(fallbackWorkspaceId);
        return;
      }
      setWorkspaceGateError(error instanceof Error ? error.message : "加载工作空间失败");
      setWorkspaceGateStatus("error");
    }
  }, [applyWorkspaceSelection]);

  useEffect(() => {
    void ensureWorkspaceContext();
  }, [ensureWorkspaceContext]);

  const workspaceGateBlocking =
    workspaceGateStatus === "selecting" || workspaceGateStatus === "error";

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[var(--surface-page)] font-sans text-[var(--text-primary)] antialiased">
      {mobileOpen ? (
        <button
          type="button"
          aria-label="关闭侧边栏"
          className="fixed inset-0 z-40 bg-slate-900/25 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-[var(--border-default)] bg-[var(--surface-sidebar)] text-[var(--text-secondary)] shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-transform duration-300 md:static md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-16 items-center justify-between px-6">
          <div className="flex items-center gap-2 text-xl font-bold tracking-tight text-[var(--text-primary)]">
            <Database className="h-6 w-6 text-[var(--action-primary)]" />
            <span>text2sql</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] md:hidden"
            onClick={() => setMobileOpen(false)}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-4 py-6 text-[var(--text-secondary)]">
          {navItems.map((item) => {
            const active = item.href === activeNavHref;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group flex items-center rounded-[10px] border px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "border-[var(--border-brand)] bg-[var(--surface-active)] text-[var(--action-primary-hover)]"
                    : "border-transparent hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                )}
              >
                <Icon
                  className={cn(
                    "mr-3 h-4 w-4 shrink-0 transition-colors",
                    active ? "text-[var(--action-primary)]" : "text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]"
                  )}
                />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-[var(--border-default)] p-4">
          <div className="flex items-center gap-3 px-2">
            <Avatar className="h-8 w-8 border border-[var(--border-brand)] bg-[var(--surface-active)]">
              <AvatarFallback className="bg-[var(--surface-active)] text-xs text-[var(--action-primary-hover)]">A</AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col">
              <p className="truncate text-sm font-medium text-[var(--text-primary)]">Admin User</p>
              <p className="truncate text-xs text-[var(--text-tertiary)]">管理员</p>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--surface-page)]">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--border-default)] bg-[var(--surface-panel)] px-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:px-6">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mr-2 text-[var(--text-tertiary)] md:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="打开侧边栏"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h1>
          </div>
          <div className="flex items-center gap-4">
            <Button type="button" variant="ghost" size="icon" aria-label="消息通知" className="text-[var(--text-tertiary)]">
              <Bell className="h-5 w-5" />
            </Button>
            <Avatar className="h-8 w-8 border border-[var(--border-default)]">
              <AvatarFallback className="bg-[var(--surface-subtle)] text-[var(--text-secondary)]">
                <User className="h-4 w-4" />
              </AvatarFallback>
            </Avatar>
          </div>
        </header>
        <main className="relative min-w-0 flex-1 overflow-auto">{children}</main>
      </div>

      {workspaceGateBlocking ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md space-y-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-panel)] p-5 shadow-[0_16px_40px_rgba(15,23,42,0.2)]">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">选择工作空间</h2>
              <p className="text-sm text-[var(--text-secondary)]">
                进入平台前先确定本次会话的工作空间。
              </p>
            </div>

            {workspaceGateStatus === "error" ? (
              <StateBlock variant="error">{workspaceGateError || "加载工作空间失败"}</StateBlock>
            ) : null}

            {workspaceGateStatus === "selecting" ? (
              <NativeSelect
                value={workspaceSelection}
                onChange={(event) => setWorkspaceSelection(event.target.value)}
                aria-label="工作空间前置选择"
              >
                {workspaceOptions.map((workspace) => (
                  <NativeSelectOption key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            ) : null}

            <div className="flex justify-end gap-2">
              {workspaceGateStatus === "error" ? (
                <Button variant="outline" onClick={() => void ensureWorkspaceContext()}>
                  重试
                </Button>
              ) : null}
              {workspaceGateStatus === "selecting" ? (
                <Button
                  disabled={!workspaceSelection.trim()}
                  onClick={() => applyWorkspaceSelection(workspaceSelection)}
                >
                  进入工作台
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
