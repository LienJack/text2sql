"use client";

import { FormEvent, useMemo, useState } from "react";
import type { Session } from "@text2sql/shared-types";
import { Plus, Search } from "lucide-react";
import { SessionActions } from "@/components/chat/session-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StateBlock } from "@/components/ui/state-block";
import { cn } from "@/lib/utils";

interface SessionSidebarProps {
  sessions: Session[];
  activeSessionId: string;
  loading?: boolean;
  error?: string;
  className?: string;
  onSelectSession: (sessionId: string) => void;
  onCreateSession: () => void;
  onRenameSession: (sessionId: string, title: string) => Promise<void>;
  onDeleteSession: (sessionId: string) => Promise<void>;
}

function statusLabel(session: Session): string | null {
  if (session.syncStatus === "degraded") {
    return "待同步异常";
  }
  if (session.syncStatus === "pending") {
    return "待同步";
  }
  return null;
}

function displayTitle(session: Session): string {
  const title = session.title?.trim();
  return title ? title : "新会话";
}

function shortSessionId(sessionId: string): string {
  if (sessionId.length <= 16) {
    return sessionId;
  }
  return `${sessionId.slice(0, 8)}…${sessionId.slice(-6)}`;
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  loading,
  error,
  className,
  onSelectSession,
  onCreateSession,
  onRenameSession,
  onDeleteSession
}: SessionSidebarProps) {
  const [editingSessionId, setEditingSessionId] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [query, setQuery] = useState("");
  const [actionError, setActionError] = useState("");

  const filteredSessions = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return sessions;
    }
    return sessions.filter((session) => {
      const title = displayTitle(session).toLowerCase();
      return title.includes(keyword) || session.id.toLowerCase().includes(keyword);
    });
  }, [query, sessions]);

  const startRename = (session: Session) => {
    setActionError("");
    setEditingSessionId(session.id);
    setDraftTitle(displayTitle(session));
  };

  const cancelRename = () => {
    setEditingSessionId("");
    setDraftTitle("");
  };

  const submitRename = async (sessionId: string) => {
    if (!draftTitle.trim()) {
      setActionError("会话标题不能为空");
      return;
    }
    try {
      await onRenameSession(sessionId, draftTitle.trim());
      cancelRename();
    } catch (renameError) {
      setActionError(renameError instanceof Error ? renameError.message : "重命名失败");
    }
  };

  const onRenameSubmit = async (event: FormEvent, sessionId: string): Promise<void> => {
    event.preventDefault();
    await submitRename(sessionId);
  };

  return (
    <aside className={cn("flex h-full w-full flex-col bg-[#171717] text-zinc-200", className)}>
      <div className="space-y-3 border-b border-zinc-800/90 p-4">
        <Button
          variant="default"
          className="h-10 w-full justify-start gap-2 rounded-xl bg-zinc-100 font-semibold text-zinc-900 shadow-none hover:bg-zinc-200"
          disabled={loading}
          onClick={onCreateSession}
        >
          <Plus className="h-4 w-4" />
          新建会话
        </Button>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索历史会话..."
            className="h-9 rounded-lg border-zinc-700 bg-zinc-900/80 pl-9 text-zinc-100 placeholder:text-zinc-500"
          />
        </div>
      </div>

      {error ? (
        <StateBlock variant="error" className="mx-3 mt-3 border-red-900/70 bg-red-950/40 text-red-200">
          {error}
        </StateBlock>
      ) : null}
      {actionError ? (
        <StateBlock variant="error" className="mx-3 mt-3 border-red-900/70 bg-red-950/40 text-red-200">
          {actionError}
        </StateBlock>
      ) : null}

      <ScrollArea className="flex-1">
        <div className="space-y-2 p-3 pb-8">
          {filteredSessions.length === 0 ? (
            <StateBlock variant="idle" className="border-zinc-700 bg-zinc-900/80 text-zinc-300">
              暂无会话，点击“新建会话”开始。
            </StateBlock>
          ) : null}

          {filteredSessions.map((session) => {
            const active = session.id === activeSessionId;
            const editing = session.id === editingSessionId;
            const badge = statusLabel(session);

            if (editing) {
              return (
                <form
                  key={session.id}
                  className="space-y-2 rounded-xl border border-zinc-700 bg-zinc-900 p-3"
                  onSubmit={(event) => {
                    void onRenameSubmit(event, session.id);
                  }}
                >
                  <Input
                    value={draftTitle}
                    autoFocus
                    aria-label="会话标题编辑"
                    onChange={(event) => setDraftTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        cancelRename();
                      }
                    }}
                  />
                  <div className="flex items-center gap-2 pt-1">
                    <Button type="submit" size="xs" variant="secondary" className="bg-zinc-100 text-zinc-900">
                      保存
                    </Button>
                    <Button type="button" size="xs" variant="ghost" className="text-zinc-300" onClick={cancelRename}>
                      取消
                    </Button>
                  </div>
                </form>
              );
            }

            return (
              <article
                key={session.id}
                className={cn(
                  "group rounded-xl border px-3 py-3 transition-colors",
                  active
                    ? "border-zinc-600 bg-zinc-800/95 shadow-sm"
                    : "border-transparent bg-transparent hover:bg-zinc-800/70"
                )}
              >
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    title={session.id}
                    onClick={() => onSelectSession(session.id)}
                  >
                    <p className="line-clamp-2 text-sm leading-5 font-medium text-zinc-100">
                      {displayTitle(session)}
                    </p>
                    <p className="mt-1 text-xs text-zinc-400">
                      {shortSessionId(session.id)}
                    </p>
                  </button>
                  <SessionActions
                    disabled={loading}
                    onRename={() => startRename(session)}
                    onDelete={() => {
                      void onDeleteSession(session.id);
                    }}
                  />
                </div>
                {badge ? (
                  <Badge variant="outline" className="mt-2 border-amber-600/50 bg-amber-900/20 text-[11px] text-amber-300">
                    {badge}
                  </Badge>
                ) : null}
              </article>
            );
          })}
        </div>
      </ScrollArea>
    </aside>
  );
}
