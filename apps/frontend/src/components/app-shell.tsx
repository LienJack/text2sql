import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AppShellProps {
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
}

export function AppShell({ title, description, children, className }: AppShellProps) {
  return (
    <main className={cn("mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 bg-[var(--surface-page)] p-4 md:p-8", className)}>
      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)] md:text-3xl">{title}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground md:text-base">{description}</p>
      </header>
      {children}
    </main>
  );
}
