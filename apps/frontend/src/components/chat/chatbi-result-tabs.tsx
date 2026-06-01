"use client";

import type { KeyboardEventHandler, ReactNode } from "react";
import { BarChart3, Code2, MessageSquare } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type ChatBIResultTabValue = "answer" | "chart" | "sql";

interface ChatBIResultTabsProps {
  value: ChatBIResultTabValue;
  onValueChange: (next: ChatBIResultTabValue) => void;
  disabledTabs?: ChatBIResultTabValue[];
  children: ReactNode;
}

interface TabDefinition {
  value: ChatBIResultTabValue;
  label: string;
  icon: typeof MessageSquare;
}

const TAB_DEFINITIONS: TabDefinition[] = [
  {
    value: "answer",
    label: "Answer",
    icon: MessageSquare
  },
  {
    value: "sql",
    label: "View SQL",
    icon: Code2
  },
  {
    value: "chart",
    label: "Chart",
    icon: BarChart3
  }
];

function buildKeyboardHandler(
  tab: ChatBIResultTabValue,
  onValueChange: (next: ChatBIResultTabValue) => void
): KeyboardEventHandler<HTMLButtonElement> {
  return (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    onValueChange(tab);
  };
}

export function ChatBIResultTabs({
  value,
  onValueChange,
  disabledTabs = [],
  children
}: ChatBIResultTabsProps) {
  return (
    <Tabs
      value={value}
      onValueChange={(next) => onValueChange(next as ChatBIResultTabValue)}
      className="gap-3"
    >
      <TabsList
        variant="line"
        aria-label="ChatBI result partitions"
        data-testid="chatbi-result-tablist"
        className="grid h-auto w-full grid-cols-3 gap-1 overflow-hidden rounded-md border border-[var(--border-default)] bg-[var(--surface-subtle)] px-1 py-1"
      >
        {TAB_DEFINITIONS.map((item) => {
          const Icon = item.icon;
          const disabled = disabledTabs.includes(item.value);
          return (
            <TabsTrigger
              key={item.value}
              value={item.value}
              disabled={disabled}
              onKeyDown={buildKeyboardHandler(item.value, onValueChange)}
              aria-label={`Switch to ${item.label} partition`}
              className="h-8 w-full min-w-0 shrink-0 justify-center gap-1 px-1.5 text-[11px] sm:gap-1.5 sm:px-2 sm:text-sm"
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              <span className="truncate">{item.label}</span>
            </TabsTrigger>
          );
        })}
      </TabsList>
      {children}
    </Tabs>
  );
}
