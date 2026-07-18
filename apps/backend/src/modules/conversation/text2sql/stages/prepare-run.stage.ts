import { Injectable } from "@nestjs/common";
import type {
  ChatMessage,
  ContextEnvelope,
  Datasource,
  Session
} from "@text2sql/shared-types";
import { v4 as uuidv4 } from "uuid";
import { DomainError } from "../../../../common/domain-error";
import { DatasourceService } from "../../../governance/datasource/datasource.service";
import { RedisBufferService } from "../../../platform/data/cache/index";
import { ChatRepository } from "../../../platform/data/persistence/index";
import {
  DatasourceSchemaSnapshotService,
  type DatasourceSchemaSnapshotV1
} from "../../../platform/data/query/index";
import {
  ChatPolicyGuardService,
  type ChatPolicyActorInput,
  type ChatSqlAccessContext
} from "../../chat/application/shared/chat-policy-guard.service";

export interface Text2SqlPrepareRunInput {
  sessionId: string;
  message: string;
  requestId?: string;
  contextEnvelope?: ContextEnvelope;
  actor?: ChatPolicyActorInput;
}

export interface Text2SqlPreparedRunContext {
  runId: string;
  session: Session;
  datasource: Datasource;
  sqlAccessContext?: ChatSqlAccessContext;
  schemaGrounding: {
    status: "ready" | "unavailable";
    snapshot?: DatasourceSchemaSnapshotV1;
    reasonCodes: string[];
  };
  question: string;
  requestId?: string;
  contextEnvelope?: ContextEnvelope;
  userPersistResult: {
    primaryPersisted: boolean;
  };
}

@Injectable()
export class PrepareRunStage {
  constructor(
    private readonly datasourceService: DatasourceService,
    private readonly redisBuffer: RedisBufferService,
    private readonly repository: ChatRepository,
    private readonly chatPolicyGuardService: ChatPolicyGuardService,
    private readonly schemaSnapshotService: DatasourceSchemaSnapshotService
  ) {}

  async run(input: Text2SqlPrepareRunInput): Promise<Text2SqlPreparedRunContext> {
    const session = await this.repository.getSessionById(input.sessionId);
    if (!session) {
      throw new DomainError("SESSION_NOT_FOUND", "会话不存在", 404, {
        sessionId: input.sessionId
      });
    }

    await this.chatPolicyGuardService.assertSessionWritableByPolicy(session);
    const datasource = await this.datasourceService.assertDatasourceAvailable(
      session.datasource
    );
    const sqlAccessContext = await this.chatPolicyGuardService.resolveSqlAccessContext(
      session,
      input.actor
    );
    const schemaGrounding = await this.captureSchemaGrounding({
      datasource,
      sqlAccessContext
    });

    const userMessage: ChatMessage = {
      id: uuidv4(),
      sessionId: input.sessionId,
      role: "user",
      content: input.message,
      createdAt: new Date().toISOString()
    };

    await this.redisBuffer.bufferMessage(userMessage);
    const userPersistResult = await this.repository.persistMessage(userMessage);
    await this.repository.ensureSessionTitleFromFirstMessage(
      input.sessionId,
      input.message
    );

    return {
      runId: uuidv4(),
      session,
      datasource,
      sqlAccessContext,
      schemaGrounding,
      question: input.message,
      requestId: input.requestId,
      contextEnvelope: input.contextEnvelope,
      userPersistResult
    };
  }

  private async captureSchemaGrounding(input: {
    datasource: Datasource;
    sqlAccessContext?: ChatSqlAccessContext;
  }): Promise<Text2SqlPreparedRunContext["schemaGrounding"]> {
    if (!input.sqlAccessContext) {
      return {
        status: "unavailable",
        reasonCodes: ["policy_receipt_unavailable"]
      };
    }
    if (input.sqlAccessContext.allowedTables.length === 0) {
      return {
        status: "unavailable",
        reasonCodes: ["allowed_schema_empty"]
      };
    }
    try {
      const snapshot = await this.schemaSnapshotService.capture({
        datasource: input.datasource,
        policy: {
          workspaceId: input.sqlAccessContext.workspaceId,
          datasourceId: input.datasource.id,
          workspaceDatasourceBindingId:
            input.sqlAccessContext.workspaceDatasourceBindingId,
          policyVersion: input.sqlAccessContext.policyVersion,
          policyDigest: input.sqlAccessContext.policyDigest,
          allowedTables: input.sqlAccessContext.allowedTables
        }
      });
      input.sqlAccessContext.allowedColumnsByTable = {
        ...snapshot.allowedSchemaSet.columnsByTable
      };
      return { status: "ready", snapshot, reasonCodes: [] };
    } catch (error) {
      return {
        status: "unavailable",
        reasonCodes: [
          error instanceof DomainError
            ? error.code.toLowerCase()
            : "schema_snapshot_unavailable"
        ]
      };
    }
  }
}
