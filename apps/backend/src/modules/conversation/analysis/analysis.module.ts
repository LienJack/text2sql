import { Module } from "@nestjs/common";
import { AppConfigModule } from "../../config/config.module";
import { GovernanceAnalysisAccessModule } from "../../governance/access/governance-analysis-access.module";
import { GovernanceAuthModule } from "../../governance/auth/governance-auth.module";
import { KnowledgeModule } from "../../knowledge";
import { PlatformDataPersistenceModule } from "../../platform/data/persistence.module";
import { PlatformDurableModule } from "../../platform/durable/platform-durable.module";
import { PlatformArtifactsModule } from "../../platform/artifacts/platform-artifacts.module";
import { ChatModule } from "../chat/chat.module";
import { Text2SqlModule } from "../text2sql/text2sql.module";
import { AnalysisController } from "./analysis.controller";
import { AnalysisTaskCommandService } from "./application/analysis-task-command.service";
import { AnalysisTaskReplayService } from "./application/analysis-task-replay.service";
import { AnalysisTaskService } from "./application/analysis-task.service";
import { CorrectionCommandService } from "./correction/correction-command.service";
import { CorrectionImpactService } from "./correction/correction-impact.service";
import { AlignmentObligationService } from "./evidence/alignment-obligation.service";
import { AnalysisReportProjectorService } from "./evidence/analysis-report-projector.service";
import { ClaimCommitService } from "./evidence/claim-commit.service";
import { ConflictSetService } from "./evidence/conflict-set.service";
import { DeterministicCalculationService } from "./evidence/deterministic-calculation.service";
import { EvidenceNormalizerService } from "./evidence/evidence-normalizer.service";
import { DataAgentEvaluationService } from "./evaluation/data-agent-evaluation.service";
import { AnalysisGoalCompilerService } from "./orchestration/analysis-goal-compiler.service";
import { AnalysisCommitGuardService } from "./orchestration/analysis-commit-guard.service";
import { AnalysisOrchestratorService } from "./orchestration/analysis-orchestrator.service";
import { CritiqueAnalysisWorker } from "./workers/critique-analysis.worker";
import { CalculationAnalysisWorker } from "./workers/calculation-analysis.worker";
import { EvidenceAlignmentWorker } from "./workers/evidence-alignment.worker";
import { ResearchAnalysisWorker } from "./workers/research-analysis.worker";
import { ReportAnalysisWorker } from "./workers/report-analysis.worker";
import { Text2SqlAnalysisWorker } from "./workers/text2sql-analysis.worker";
import {
  ANALYSIS_WORKERS,
  AnalysisWorkerRegistryService
} from "./workers/worker-registry.service";

@Module({
  imports: [
    AppConfigModule,
    GovernanceAuthModule,
    GovernanceAnalysisAccessModule,
    KnowledgeModule,
    PlatformDataPersistenceModule,
    PlatformDurableModule,
    PlatformArtifactsModule,
    ChatModule,
    Text2SqlModule
  ],
  controllers: [AnalysisController],
  providers: [
    AnalysisTaskService,
    AnalysisTaskCommandService,
    AnalysisTaskReplayService,
    AnalysisGoalCompilerService,
    AnalysisCommitGuardService,
    AnalysisOrchestratorService,
    CorrectionImpactService,
    CorrectionCommandService,
    EvidenceNormalizerService,
    AlignmentObligationService,
    DeterministicCalculationService,
    ClaimCommitService,
    ConflictSetService,
    AnalysisReportProjectorService,
    DataAgentEvaluationService,
    Text2SqlAnalysisWorker,
    ResearchAnalysisWorker,
    EvidenceAlignmentWorker,
    CalculationAnalysisWorker,
    CritiqueAnalysisWorker,
    ReportAnalysisWorker,
    {
      provide: ANALYSIS_WORKERS,
      inject: [
        Text2SqlAnalysisWorker,
        ResearchAnalysisWorker,
        EvidenceAlignmentWorker,
        CalculationAnalysisWorker,
        CritiqueAnalysisWorker,
        ReportAnalysisWorker
      ],
      useFactory: (
        text2sql: Text2SqlAnalysisWorker,
        research: ResearchAnalysisWorker,
        evidenceAlignment: EvidenceAlignmentWorker,
        calculation: CalculationAnalysisWorker,
        critique: CritiqueAnalysisWorker,
        report: ReportAnalysisWorker
      ) => [
        text2sql,
        research,
        evidenceAlignment,
        calculation,
        critique,
        report
      ]
    },
    AnalysisWorkerRegistryService
  ],
  exports: [
    AnalysisTaskService,
    AnalysisTaskCommandService,
    AnalysisOrchestratorService,
    CorrectionCommandService,
    DataAgentEvaluationService
  ]
})
export class AnalysisModule {}
