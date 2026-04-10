"use client";

import { FormEvent, useState } from "react";
import type { Session } from "@text2sql/shared-types";
import { PlusIcon } from "lucide-react";
import { SessionActions } from "@/components/chat/session-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator
} from "@/components/ui/sidebar";
import { StateBlock } from "@/components/ui/state-block";

interface SessionSidebarProps {
  sessions: Session[];
  activeSessionId: string;
  loading?: boolean;
  error?: string;
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
  if (title) {
    return title;
  }
  return "新会话";
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  loading,
  error,
  onSelectSession,
  onCreateSession,
  onRenameSession,
  onDeleteSession
}: SessionSidebarProps) {
  const [editingSessionId, setEditingSessionId] = useState<string>("");
  const [draftTitle, setDraftTitle] = useState("");
  const [actionError, setActionError] = useState("");

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
      setActionError(
        renameError instanceof Error ? renameError.message : "重命名失败"
      );
    }
  };

  const onRenameSubmit = async (
    event: FormEvent,
    sessionId: string
  ): Promise<void> => {
    event.preventDefault();
    await submitRename(sessionId);
  };

  return (
    <Sidebar side="left" collapsible="offcanvas">
      <SidebarHeader>
        <div className="space-y-1 px-2 py-1">
          <h2 className="text-sm font-semibold">会话记录</h2>
          <p className="text-xs text-muted-foreground">切换、重命名或删除历史会话。</p>
        </div>
        <Button
          variant="outline"
          className="justify-start"
          disabled={loading}
          onClick={onCreateSession}
        >
          <PlusIcon />
          新建会话
        </Button>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>最近会话</SidebarGroupLabel>
          <SidebarGroupContent>
            {error ? <StateBlock variant="error">{error}</StateBlock> : null}
            {actionError ? <StateBlock variant="error">{actionError}</StateBlock> : null}
            {sessions.length === 0 ? (
              <StateBlock variant="idle">暂无会话，点击“新建会话”开始。</StateBlock>
            ) : null}
            <SidebarMenu>
              {sessions.map((session) => {
                const active = session.id === activeSessionId;
                const editing = session.id === editingSessionId;
                const badge = statusLabel(session);

                return (
                  <SidebarMenuItem key={session.id}>
                    {editing ? (
                      <form
                        className="space-y-2 rounded-md border border-border p-2"
                        onSubmit={(event) => {
                          void onRenameSubmit(event, session.id);
                        }}
                      >
                        <Input
                          aria-label="会话标题编辑"
                          value={draftTitle}
                          autoFocus
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
                    ) : (
                      <div className="space-y-1">
                        <div className="flex items-start gap-1">
                          <SidebarMenuButton
                            isActive={active}
                            className="h-auto flex-1 items-start py-2"
                            onClick={() => onSelectSession(session.id)}
                          >
                            <div className="min-w-0 space-y-1">
                              <div className="truncate font-medium">{displayTitle(session)}</div>
                              <div className="truncate text-xs text-muted-foreground">
                                {session.id}
                              </div>
                            </div>
                          </SidebarMenuButton>
                          <SessionActions
                            disabled={loading}
                            onRename={() => startRename(session)}
                            onDelete={() => {
                              void onDeleteSession(session.id);
                            }}
                          />
                        </div>
                        {badge ? (
                          <Badge variant="outline" className="ml-2 text-[11px]">
                            {badge}
                          </Badge>
                        ) : null}
                      </div>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
