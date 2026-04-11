"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, BookOpen, Database, LayoutDashboard, Menu, MessageSquare, Settings, Sparkles, User, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PlatformShellProps {
  children: ReactNode;
}

const navItems = [
  { href: "/", label: "总览", icon: LayoutDashboard },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/data-sources", label: "数据源", icon: Database },
  { href: "/dashboards", label: "看板", icon: LayoutDashboard },
  { href: "/glossary", label: "术语库", icon: BookOpen },
  { href: "/prompts", label: "提示词", icon: Sparkles },
  { href: "/settings", label: "系统设置", icon: Settings }
];

function isNavActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PlatformShell({ children }: PlatformShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const title = useMemo(() => {
    const activeItem = navItems.find((item) => isNavActive(pathname, item.href));
    return activeItem?.label ?? "工作台";
  }, [pathname]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

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
            const active = isNavActive(pathname, item.href);
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
    </div>
  );
}
