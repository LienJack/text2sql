import { RagEventConsumerService } from "../../src/modules/rag/events/rag-event-consumer.service";
import type { BuildRagIndexJob } from "../../src/modules/rag/jobs/build-rag-index.job";
import type { RagReplayRepository } from "../../src/modules/rag/observability/rag-replay.repository";
import type { AuditLogRepository } from "../../src/modules/data/persistence/audit-log.repository";

describe("RagEventConsumerService", () => {
  it("processes event once and returns duplicate on repeated idempotency key", async () => {
    const buildJob: Pick<BuildRagIndexJob, "run"> = {
      run: jest.fn().mockResolvedValue({
        indexVersionId: "idx-event-unit-1",
        datasourceId: "ds-event-unit",
        status: "active",
        entryCount: 2,
        archivedChannels: ["lexical", "dense"],
        denseMode: "mock_provider",
        activation: {
          replacedVersionIds: [],
          replacedSourceVersions: []
        }
      })
    };
    const replayRepository: Pick<RagReplayRepository, "writeReplay"> = {
      writeReplay: jest.fn().mockResolvedValue(undefined)
    };
    const auditRepository: Pick<AuditLogRepository, "appendEvent"> = {
      appendEvent: jest.fn().mockResolvedValue(undefined)
    };

    const service = new RagEventConsumerService(
      buildJob as BuildRagIndexJob,
      replayRepository as RagReplayRepository,
      auditRepository as AuditLogRepository
    );

    const first = await service.consumeEvent({
      eventId: "evt-unit-1",
      datasourceId: "ds-event-unit",
      sourceVersion: "schema-v1",
      eventType: "ddl_changed",
      runId: "run-event-unit-1",
      occurredAt: "2026-04-18T01:00:00.000Z"
    });
    const second = await service.consumeEvent({
      eventId: "evt-unit-1",
      datasourceId: "ds-event-unit",
      sourceVersion: "schema-v1",
      eventType: "ddl_changed",
      runId: "run-event-unit-1",
      occurredAt: "2026-04-18T01:00:01.000Z"
    });

    expect(first.status).toBe("processed");
    expect(first.indexVersionId).toBe("idx-event-unit-1");
    expect(second.status).toBe("duplicate");
    expect(buildJob.run).toHaveBeenCalledTimes(1);
    expect(replayRepository.writeReplay).toHaveBeenCalledTimes(2);
    expect(auditRepository.appendEvent).toHaveBeenCalledTimes(1);
  });

  it("schedules retries and moves event to DLQ after max attempts", async () => {
    const buildJob: Pick<BuildRagIndexJob, "run"> = {
      run: jest.fn().mockRejectedValue(new Error("index build failed"))
    };
    const replayRepository: Pick<RagReplayRepository, "writeReplay"> = {
      writeReplay: jest.fn().mockResolvedValue(undefined)
    };
    const auditRepository: Pick<AuditLogRepository, "appendEvent"> = {
      appendEvent: jest.fn().mockResolvedValue(undefined)
    };

    const service = new RagEventConsumerService(
      buildJob as BuildRagIndexJob,
      replayRepository as RagReplayRepository,
      auditRepository as AuditLogRepository
    );

    const first = await service.consumeEvent({
      eventId: "evt-unit-dlq-1",
      datasourceId: "ds-event-unit",
      sourceVersion: "schema-v2",
      eventType: "sql_feedback_positive",
      runId: "run-event-unit-dlq"
    });
    const second = await service.consumeEvent({
      eventId: "evt-unit-dlq-1",
      datasourceId: "ds-event-unit",
      sourceVersion: "schema-v2",
      eventType: "sql_feedback_positive",
      runId: "run-event-unit-dlq"
    });
    const third = await service.consumeEvent({
      eventId: "evt-unit-dlq-1",
      datasourceId: "ds-event-unit",
      sourceVersion: "schema-v2",
      eventType: "sql_feedback_positive",
      runId: "run-event-unit-dlq"
    });
    const duplicateAfterDlq = await service.consumeEvent({
      eventId: "evt-unit-dlq-1",
      datasourceId: "ds-event-unit",
      sourceVersion: "schema-v2",
      eventType: "sql_feedback_positive",
      runId: "run-event-unit-dlq"
    });

    expect(first.status).toBe("retry_scheduled");
    expect(first.attempts).toBe(1);
    expect(second.status).toBe("retry_scheduled");
    expect(second.attempts).toBe(2);
    expect(third.status).toBe("dlq");
    expect(third.attempts).toBe(3);
    expect(duplicateAfterDlq.status).toBe("duplicate");
    expect(buildJob.run).toHaveBeenCalledTimes(3);
  });
});
