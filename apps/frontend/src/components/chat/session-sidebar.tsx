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
    <aside className={cn("flex h-full w-full flex-col bg-slate-50/70", className)}>
      <div className="space-y-3 border-b border-slate-200 p-4">
        <Button
          variant="default"
          className="w-full justify-start gap-2 font-semibold shadow-sm"
          disabled={loading}
          onClick={onCreateSession}
        >
          <Plus className="h-4 w-4" />
          新建会话
        </Button>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索历史会话..."
            className="pl-9"
          />
        </div>
      </div>

      {error ? <StateBlock variant="error" className="mx-3 mt-3">{error}</StateBlock> : null}
      {actionError ? <StateBlock variant="error" className="mx-3 mt-3">{actionError}</StateBlock> : null}

      <ScrollArea className="flex-1">
        <div className="space-y-2 p-3">
          {filteredSessions.length === 0 ? (
            <StateBlock variant="idle">暂无会话，点击“新建会话”开始。</StateBlock>
          ) : null}

          {filteredSessions.map((session) => {
            const active = session.id === activeSessionId;
            const editing = session.id === editingSessionId;
            const badge = statusLabel(session);

            if (editing) {
              return (
                <form
                  key={session.id}
                  className="space-y-2 rounded-lg border border-slate-200 bg-white p-3"
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
                  <div className="flex items-center gap-2">
                    <Button type="submit" size="xs" variant="secondary">
                      保存
                    </Button>
                    <Button type="button" size="xs" variant="ghost" onClick={cancelRename}>
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
                  "group rounded-md border px-3 py-3 transition-colors",
                  active
                    ? "border-teal-200 bg-teal-50 shadow-sm"
                    : "border-transparent bg-transparent hover:bg-slate-100/50"
                )}
              >
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => onSelectSession(session.id)}
                  >
                    <p className="truncate text-sm font-medium text-slate-900">{displayTitle(session)}</p>
                    <p className="mt-1 truncate text-xs text-slate-500">{session.id}</p>
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
                  <Badge variant="outline" className="mt-2 text-[11px]">
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
