import { Injectable } from "@nestjs/common";
import { TraceService } from "../observability/trace.service";
import { RedisBufferService } from "./data/cache/index";
import {
  ChatRepository,
  WorkspaceDatasourcePolicyRepository
} from "./data/persistence/index";

@Injectable()
export class PlatformChatRuntimeFacade {
  constructor(
    readonly redisBufferService: RedisBufferService,
    readonly chatRepository: ChatRepository,
    readonly workspaceDatasourcePolicyRepository: WorkspaceDatasourcePolicyRepository,
    readonly traceService: TraceService
  ) {}
}
