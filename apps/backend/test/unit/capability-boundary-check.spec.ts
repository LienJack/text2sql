import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCapabilityBoundaryCheck } from "../../../../scripts/check-backend-capability-boundaries";

async function writeRepoFile(
  repoRoot: string,
  relativePath: string,
  content: string
): Promise<void> {
  const absolutePath = path.join(repoRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
}

describe("capability boundary check", () => {
  let repoRoot = "";

  beforeEach(async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), "cap-boundary-check-"));
  });

  afterEach(async () => {
    if (repoRoot) {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("allows governance -> platform imports", async () => {
    await writeRepoFile(
      repoRoot,
      "apps/backend/src/modules/governance/user/user.service.ts",
      `import { DatasourceRepository } from "../../data/persistence/datasource.repository";
export class UserService {
  constructor(private readonly datasourceRepository: DatasourceRepository) {}
}
`
    );
    await writeRepoFile(
      repoRoot,
      "apps/backend/src/modules/data/persistence/datasource.repository.ts",
      "export class DatasourceRepository {}"
    );

    const report = await runCapabilityBoundaryCheck({ repoRoot });
    expect(report.violations).toHaveLength(0);
  });

  it("reports platform -> governance violations with location details", async () => {
    await writeRepoFile(
      repoRoot,
      "apps/backend/src/modules/platform/system/system.module.ts",
      `import { PolicyEvaluatorService } from "../../governance/access/policy-evaluator.service";
export class SystemModule {
  constructor(private readonly policyEvaluator: PolicyEvaluatorService) {}
}
`
    );
    await writeRepoFile(
      repoRoot,
      "apps/backend/src/modules/governance/access/policy-evaluator.service.ts",
      "export class PolicyEvaluatorService {}"
    );

    const report = await runCapabilityBoundaryCheck({
      repoRoot,
      allowRules: []
    });

    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toMatchObject({
      sourceDomain: "platform",
      targetDomain: "governance",
      sourceFile: "apps/backend/src/modules/platform/system/system.module.ts",
      targetFile: "apps/backend/src/modules/governance/access/policy-evaluator.service.ts",
      line: 1
    });
  });

  it("keeps first-pass migration allow rule for platform/data access bridge", async () => {
    await writeRepoFile(
      repoRoot,
      "apps/backend/src/modules/platform/data/access.module.ts",
      `import { PolicyEvaluatorService } from "../../governance/access/policy-evaluator.service";
export class PlatformDataAccessModule {
  constructor(private readonly policyEvaluator: PolicyEvaluatorService) {}
}
`
    );
    await writeRepoFile(
      repoRoot,
      "apps/backend/src/modules/governance/access/policy-evaluator.service.ts",
      "export class PolicyEvaluatorService {}"
    );

    const report = await runCapabilityBoundaryCheck({ repoRoot });
    expect(report.violations).toHaveLength(0);
  });
});
