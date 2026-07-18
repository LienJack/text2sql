import { Inject, Injectable } from "@nestjs/common";
import { DomainError } from "../../../../common/domain-error";
import type { AnalysisWorkKind } from "../orchestration/work-graph.types";
import type {
  AnalysisCapability,
  AnalysisWorker,
  AnalysisWorkerInvocation
} from "./worker-contract.types";

export const ANALYSIS_WORKERS = Symbol("ANALYSIS_WORKERS");

@Injectable()
export class AnalysisWorkerRegistryService {
  private readonly workers = new Map<string, AnalysisWorker>();

  constructor(@Inject(ANALYSIS_WORKERS) workers: AnalysisWorker[]) {
    for (const worker of workers) {
      if (this.workers.has(worker.workerId)) {
        throw new Error(`duplicate analysis worker: ${worker.workerId}`);
      }
      this.workers.set(worker.workerId, worker);
    }
  }

  resolve(workerId: string, workKind: AnalysisWorkKind): AnalysisWorker {
    const worker = this.workers.get(workerId);
    if (!worker || !worker.workKinds.includes(workKind)) {
      throw new DomainError(
        "ANALYSIS_WORKER_NOT_AVAILABLE",
        `没有可执行 ${workKind} 的 worker ${workerId}。`,
        409
      );
    }
    return worker;
  }

  assertInvocationGrant(
    worker: AnalysisWorker,
    invocation: AnalysisWorkerInvocation
  ): void {
    this.assertCapabilitySubset(worker.capabilities, invocation.capabilityGrant);
  }

  assertCapabilitySubset(
    allowed: AnalysisCapability[],
    requested: AnalysisCapability[]
  ): void {
    const allowlist = new Set(allowed);
    const denied = requested.filter((capability) => !allowlist.has(capability));
    if (denied.length > 0) {
      throw new DomainError(
        "ANALYSIS_CAPABILITY_ESCALATION_DENIED",
        "Worker 请求了 grant 之外的 capability。",
        403,
        { denied }
      );
    }
  }
}
