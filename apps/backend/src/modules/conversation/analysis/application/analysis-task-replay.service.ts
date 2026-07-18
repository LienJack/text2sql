import { Injectable } from "@nestjs/common";
import type { AnalysisTaskReadModel } from "@text2sql/analysis-task-protocol";
import { AnalysisTaskService } from "./analysis-task.service";

export type AnalysisTaskReplay = {
  mode: "artifact_only";
  externalCallCount: 0;
  replayedAt: string;
  retention: {
    expiresAt?: string | null;
    payloadAvailability: "available" | "partially_unavailable";
  };
  readModel: AnalysisTaskReadModel;
};

@Injectable()
export class AnalysisTaskReplayService {
  constructor(private readonly tasks: AnalysisTaskService) {}

  async replay(
    actor: Express.RequestActor,
    taskId: string
  ): Promise<AnalysisTaskReplay> {
    const readModel = await this.tasks.get(actor, taskId);
    return {
      mode: "artifact_only",
      externalCallCount: 0,
      replayedAt: new Date().toISOString(),
      retention: {
        expiresAt: readModel.task.retentionExpiresAt,
        payloadAvailability: readModel.artifacts.every(
          (artifact) => artifact.payloadAvailable
        )
          ? "available"
          : "partially_unavailable"
      },
      readModel
    };
  }
}
