import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

const variantStyles = {
  idle: "border-border bg-secondary/60 text-muted-foreground",
  loading: "border-primary/30 bg-primary/10 text-primary",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  error: "border-destructive/30 bg-destructive/10 text-destructive"
} as const;

interface StateBlockProps {
  variant: keyof typeof variantStyles;
  children: ReactNode;
  className?: string;
}

export function StateBlock({ variant, children, className }: StateBlockProps) {
  return (
    <p className={cn("rounded-md border px-3 py-2 text-sm", variantStyles[variant], className)}>
      {children}
    </p>
  );
}
