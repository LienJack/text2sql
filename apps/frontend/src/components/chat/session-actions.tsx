"use client";

import { PencilIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SessionActionsProps {
  disabled?: boolean;
  onRename: () => void;
  onDelete: () => void;
}

export function SessionActions({
  disabled,
  onRename,
  onDelete
}: SessionActionsProps) {
  return (
    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
      <Button
        size="icon-xs"
        variant="ghost"
        className="text-zinc-400 hover:bg-zinc-700/70 hover:text-zinc-100"
        disabled={disabled}
        aria-label="重命名会话"
        onClick={(event) => {
          event.stopPropagation();
          onRename();
        }}
      >
        <PencilIcon />
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        className="text-zinc-400 hover:bg-zinc-700/70 hover:text-zinc-100"
        disabled={disabled}
        aria-label="删除会话"
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
      >
        <Trash2Icon />
      </Button>
    </div>
  );
}
