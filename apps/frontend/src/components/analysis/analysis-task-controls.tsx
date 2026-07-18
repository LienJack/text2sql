import type { AnalysisTaskRecord } from "@text2sql/shared-types";
import { CirclePause, CirclePlay, LoaderCircle, OctagonX, StepForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AnalysisConnectionState } from "@/lib/analysis-api-client";
import { isAnalysisTerminal } from "@/lib/analysis-api-client";

export function AnalysisTaskControls({
  task,
  connection,
  busy,
  onCommand,
  onRunNext
}: {
  task: AnalysisTaskRecord;
  connection: AnalysisConnectionState;
  busy: boolean;
  onCommand: (command: "start" | "pause" | "resume" | "cancel") => Promise<void>;
  onRunNext: () => Promise<void>;
}) {
  const terminal = isAnalysisTerminal(task.status);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 flex items-center gap-1.5 text-xs text-stone-500" aria-live="polite">
        <span className={`size-2 rounded-full ${connection === "live" ? "bg-emerald-500" : connection === "closed" ? "bg-stone-400" : "bg-amber-500"}`} />
        {connection === "live" ? "实时同步" : connection === "closed" ? "事件流已封存" : "正在连接"}
      </span>
      {task.status === "draft" ? <Button size="sm" disabled={busy} onClick={() => void onCommand("start")}><CirclePlay />启动</Button> : null}
      {task.status === "paused" ? <Button size="sm" disabled={busy} onClick={() => void onCommand("resume")}><CirclePlay />继续</Button> : null}
      {task.status === "running" ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void onCommand("pause")}><CirclePause />暂停</Button> : null}
      {(task.status === "queued" || task.status === "running") ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void onRunNext()}><StepForward />推进一步</Button> : null}
      {!terminal && task.status !== "draft" && task.status !== "cancelling" ? <Button size="sm" variant="destructive" disabled={busy} onClick={() => void onCommand("cancel")}><OctagonX />取消</Button> : null}
      {busy ? <LoaderCircle className="size-4 animate-spin text-stone-500" aria-label="操作处理中" /> : null}
    </div>
  );
}
