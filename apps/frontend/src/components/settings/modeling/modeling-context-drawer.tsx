"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ModelingContextDrawer(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const { open, onOpenChange, children } = props;

  useEffect(() => {
    if (!open || typeof window === "undefined") {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onOpenChange, open]);

  return (
    <>
      {open ? (
        <button
          type="button"
          aria-label="关闭 Modeling Context Drawer"
          className="fixed inset-0 z-30 bg-black/20"
          onClick={() => {
            onOpenChange(false);
          }}
        />
      ) : null}
      <div
        data-testid="modeling-context-drawer"
        data-open={open ? "true" : "false"}
        className={cn(
          "space-y-4",
          open
            ? "fixed inset-y-3 right-3 z-40 w-[min(420px,calc(100vw-1.5rem))] rounded-xl border border-[var(--border-default)] bg-white p-3 shadow-2xl"
            : "relative"
        )}
      >
        {open ? (
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                onOpenChange(false);
              }}
              aria-label="关闭 Context Drawer"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
        <div className={cn(open ? "max-h-[calc(100vh-4.5rem)] space-y-4 overflow-y-auto pr-1" : "space-y-4")}>
          {children}
        </div>
      </div>
    </>
  );
}
