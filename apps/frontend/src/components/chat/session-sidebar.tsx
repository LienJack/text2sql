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
  readonlySessions?: Session[];
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
  if (session.datasourceStatus === "deleted") {
    return "数据源已删除";
  }
  if (session.datasourceStatus === "unavailable") {
    return "数据源不可用";
  }
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
  readonlySessions = [],
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

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const matcher = (session: Session) => {
      if (!keyword) {
        return true;
      }
      const title = displayTitle(session).toLowerCase();
      return title.includes(keyword) || session.id.toLowerCase().includes(keyword);
    };
    return {
      writable: sessions.filter(matcher),
      readonly: readonlySessions.filter(matcher)
    };
  }, [query, readonlySessions, sessions]);

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
    <aside className={cn("flex h-full w-full flex-col bg-[var(--surface-sidebar)] text-[var(--text-secondary)]", className)}>
      <div className="space-y-3 border-b border-[var(--border-default)] p-4">
        <Button
          variant="default"
          className="h-10 w-full justify-start gap-2 rounded-[10px] font-semibold shadow-none"
          disabled={loading}
          onClick={onCreateSession}
        >
          <Plus className="h-4 w-4" />
          新建会话
        </Button>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[var(--text-tertiary)]" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索历史会话..."
            className="h-9 rounded-[10px] border-[var(--border-strong)] bg-[var(--surface-panel)] pl-9 text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
          />
        </div>
      </div>

      {error ? (
        <StateBlock variant="error" className="mx-3 mt-3">
          {error}
        </StateBlock>
      ) : null}
      {actionError ? (
        <StateBlock variant="error" className="mx-3 mt-3">
          {actionError}
        </StateBlock>
      ) : null}

      <ScrollArea className="flex-1">
        <div className="space-y-2 p-3 pb-8">
          {filtered.writable.length === 0 && filtered.readonly.length === 0 ? (
            <StateBlock variant="idle" className="border-[var(--border-default)] bg-[var(--surface-panel)] text-[var(--text-secondary)]">
              暂无会话，点击“新建会话”开始。
            </StateBlock>
          ) : null}

          {filtered.writable.length > 0 ? (
            <section className="space-y-2">
              <p className="px-1 text-[11px] font-semibold tracking-wide text-[var(--text-tertiary)] uppercase">
                当前可写会话
              </p>
              {filtered.writable.map((session) => {
                const active = session.id === activeSessionId;
                const editing = session.id === editingSessionId;
                const badge = statusLabel(session);

                if (editing) {
                  return (
                    <form
                      key={session.id}
                      className="space-y-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-panel)] p-3"
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
                        <Button type="submit" size="xs" variant="default">
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
                      "group rounded-xl border px-3 py-3 transition-colors",
                      active
                        ? "border-[var(--border-brand)] bg-[var(--surface-active)] shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
                        : "border-transparent bg-transparent hover:bg-[var(--surface-hover)]"
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        title={session.id}
                        onClick={() => onSelectSession(session.id)}
                      >
                        <p className="line-clamp-2 text-sm leading-5 font-medium text-[var(--text-primary)]">
                          {displayTitle(session)}
                        </p>
                        <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                          {shortSessionId(session.id)}
                        </p>
                        <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                          {(session.datasourceName || session.datasource).trim()} ·{" "}
                          {session.datasourceType ?? "-"}
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
                      <Badge
                        variant="outline"
                        className={cn(
                          "mt-2 text-[11px]",
                          session.datasourceStatus === "unavailable" ||
                            session.datasourceStatus === "deleted"
                            ? "border-rose-300 bg-rose-50 text-rose-700"
                            : "border-amber-300 bg-amber-50 text-amber-700"
                        )}
                      >
                        {badge}
                      </Badge>
                    ) : null}
                  </article>
                );
              })}
            </section>
          ) : null}

          {filtered.readonly.length > 0 ? (
            <section className="space-y-2 pt-2">
              <p className="px-1 text-[11px] font-semibold tracking-wide text-[var(--text-tertiary)] uppercase">
                只读历史
              </p>
              {filtered.readonly.map((session) => {
                const active = session.id === activeSessionId;
                const badge = statusLabel(session) ?? "只读";
                return (
                  <article
                    key={session.id}
                    className={cn(
                      "group rounded-xl border px-3 py-3 transition-colors",
                      active
                        ? "border-[var(--border-brand)] bg-[var(--surface-active)] shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
                        : "border-transparent bg-transparent hover:bg-[var(--surface-hover)]"
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        title={session.id}
                        onClick={() => onSelectSession(session.id)}
                      >
                        <p className="line-clamp-2 text-sm leading-5 font-medium text-[var(--text-primary)]">
                          {displayTitle(session)}
                        </p>
                        <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                          {shortSessionId(session.id)}
                        </p>
                        <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                          {(session.datasourceName || session.datasource).trim()} ·{" "}
                          {session.datasourceType ?? "-"}
                        </p>
                      </button>
                      <SessionActions
                        disabled
                        onRename={() => {
                          setActionError("只读历史会话不支持重命名。");
                        }}
                        onDelete={() => {
                          setActionError("只读历史会话不支持删除。");
                        }}
                      />
                    </div>
                    <Badge
                      variant="outline"
                      className="mt-2 border-rose-300 bg-rose-50 text-[11px] text-rose-700"
                    >
                      {badge}
                    </Badge>
                  </article>
                );
              })}
            </section>
          ) : null}
        </div>
      </ScrollArea>
    </aside>
  );
}
