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
    <div className="flex h-screen w-full overflow-hidden bg-slate-50 font-sans text-slate-950 antialiased">
      {mobileOpen ? (
        <button
          type="button"
          aria-label="关闭侧边栏"
          className="fixed inset-0 z-40 bg-slate-950/80 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-slate-950 text-slate-200 transition-transform duration-300 md:static md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-16 items-center justify-between px-6">
          <div className="flex items-center gap-2 text-xl font-bold tracking-tight text-white">
            <Database className="h-6 w-6 text-teal-400" />
            <span>text2sql</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-slate-400 hover:text-white md:hidden"
            onClick={() => setMobileOpen(false)}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-4 py-6 text-slate-300">
          {navItems.map((item) => {
            const active = isNavActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-teal-500/10 text-teal-400"
                    : "hover:bg-slate-800 hover:text-slate-50"
                )}
              >
                <Icon
                  className={cn(
                    "mr-3 h-4 w-4 shrink-0 transition-colors",
                    active ? "text-teal-400" : "text-slate-500 group-hover:text-slate-50"
                  )}
                />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-800 p-4">
          <div className="flex items-center gap-3 px-2">
            <Avatar className="h-8 w-8 bg-teal-600">
              <AvatarFallback className="bg-teal-600 text-xs text-white">A</AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col">
              <p className="truncate text-sm font-medium text-slate-50">Admin User</p>
              <p className="truncate text-xs text-slate-400">管理员</p>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-slate-50">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 shadow-sm sm:px-6">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mr-2 text-slate-500 md:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="打开侧边栏"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
          </div>
          <div className="flex items-center gap-4">
            <Button type="button" variant="ghost" size="icon" aria-label="消息通知" className="text-slate-500">
              <Bell className="h-5 w-5" />
            </Button>
            <Avatar className="h-8 w-8 border border-slate-200">
              <AvatarFallback className="bg-slate-100 text-slate-600">
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
