import type { AnalysisTaskRecord, AnalysisTaskStatus } from "@text2sql/shared-types";
import { Clock3, FileClock, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<AnalysisTaskStatus, string> = {
  draft: "草稿",
  queued: "排队中",
  running: "分析中",
  waiting_for_human: "等待决策",
  pausing: "暂停中",
  paused: "已暂停",
  cancelling: "取消中",
  completed: "已完成",
  partial: "部分完成",
  cancelled: "已取消",
  failed: "失败"
};

export function analysisStatusLabel(status: AnalysisTaskStatus): string {
  return STATUS_LABELS[status];
}

function statusClass(status: AnalysisTaskStatus): string {
  if (status === "completed") return "border-emerald-300 bg-emerald-50 text-emerald-800";
  if (status === "running" || status === "queued") return "border-blue-300 bg-blue-50 text-blue-800";
  if (status === "waiting_for_human" || status === "partial") return "border-amber-300 bg-amber-50 text-amber-900";
  if (status === "failed" || status === "cancelled") return "border-red-300 bg-red-50 text-red-800";
  return "border-stone-300 bg-stone-100 text-stone-700";
}

export function AnalysisTaskList({
  tasks,
  selectedTaskId,
  onSelect,
  onCreate
}: {
  tasks: AnalysisTaskRecord[];
  selectedTaskId: string;
  onSelect: (taskId: string) => void;
  onCreate: () => void;
}) {
  return (
    <aside className="flex min-h-0 flex-col border-b border-stone-200 bg-[#f6f2e8] lg:border-r lg:border-b-0">
      <div className="flex items-start justify-between gap-3 border-b border-stone-200 px-4 py-4">
        <div>
          <p className="font-serif text-lg font-semibold text-stone-950">分析卷宗</p>
          <p className="mt-0.5 text-xs text-stone-500">关闭页面不会取消任务</p>
        </div>
        <Button size="icon-sm" onClick={onCreate} aria-label="新建分析任务">
          <Plus aria-hidden="true" />
        </Button>
      </div>
      <ScrollArea className="max-h-72 flex-1 lg:max-h-none">
        <div className="space-y-2 p-3" aria-label="分析任务列表">
          {tasks.length === 0 ? (
            <div className="rounded-lg border border-dashed border-stone-300 p-5 text-center text-sm text-stone-500">
              <FileClock className="mx-auto mb-2 size-5" aria-hidden="true" />
              尚无分析任务
            </div>
          ) : null}
          {tasks.map((task) => (
            <Button
              key={task.id}
              type="button"
              variant="ghost"
              className={cn(
                "h-auto w-full justify-start rounded-lg border px-3 py-3 text-left whitespace-normal",
                task.id === selectedTaskId
                  ? "border-blue-300 bg-white shadow-[0_3px_12px_rgba(30,64,175,0.08)] hover:bg-white"
                  : "border-transparent bg-transparent hover:border-stone-200 hover:bg-white/70"
              )}
              aria-pressed={task.id === selectedTaskId}
              onClick={() => onSelect(task.id)}
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-xs font-semibold text-stone-800">
                    {task.id.slice(0, 12)}
                  </span>
                  <Badge variant="outline" className={statusClass(task.status)}>
                    {analysisStatusLabel(task.status)}
                  </Badge>
                </span>
                <span className="mt-2 flex items-center gap-1 text-[11px] font-normal text-stone-500">
                  <Clock3 className="size-3" aria-hidden="true" />
                  {new Date(task.updatedAt).toLocaleString("zh-CN", {
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit"
                  })}
                  <span>· R{task.currentRevisionNumber}</span>
                </span>
              </span>
            </Button>
          ))}
        </div>
      </ScrollArea>
    </aside>
  );
}
