"use client";

import type { ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export type RagDeliverySectionSeverity = "critical" | "warning" | "normal";

interface RagDeliverySectionProps {
  id: "answer" | "evidence" | "artifact";
  title: string;
  open: boolean;
  severity?: RagDeliverySectionSeverity;
  summary?: string;
  onOpenChange: (nextOpen: boolean) => void;
  children: ReactNode;
}

function resolveBadgeVariant(
  severity: RagDeliverySectionSeverity
): "destructive" | "secondary" | "outline" {
  if (severity === "critical") {
    return "destructive";
  }
  if (severity === "warning") {
    return "secondary";
  }
  return "outline";
}

function resolveBadgeLabel(severity: RagDeliverySectionSeverity): string {
  if (severity === "critical") {
    return "critical";
  }
  if (severity === "warning") {
    return "warning";
  }
  return "normal";
}

export function RagDeliverySection({
  id,
  title,
  open,
  severity = "normal",
  summary,
  onOpenChange,
  children
}: RagDeliverySectionProps) {
  return (
    <Collapsible
      open={open}
      onOpenChange={(nextOpen) => onOpenChange(nextOpen)}
      className="rounded-[10px] border border-[var(--border-default)] bg-[var(--surface-subtle)]"
    >
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className={cn(
            "h-auto min-h-11 w-full justify-between rounded-[10px] px-3 py-2 text-left hover:bg-[var(--surface-active)]",
            open ? "rounded-b-none" : ""
          )}
          aria-controls={`rag-delivery-section-${id}`}
          aria-label={`切换 ${title} 区块`}
        >
          <span className="space-y-0.5">
            <span className="inline-flex items-center gap-2 text-[11px] font-semibold tracking-wider text-[var(--text-tertiary)] uppercase">
              {title}
              <Badge variant={resolveBadgeVariant(severity)}>
                {resolveBadgeLabel(severity)}
              </Badge>
            </span>
            {summary ? (
              <span className="block text-xs font-normal text-[var(--text-secondary)]">
                {summary}
              </span>
            ) : null}
          </span>
          {open ? (
            <ChevronUp className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" />
          )}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent
        id={`rag-delivery-section-${id}`}
        className="border-t border-[var(--border-default)] px-3 py-3"
      >
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
