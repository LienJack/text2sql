import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { RagQualityService } from "../../src/modules/rag/quality/rag-quality.service";
import { createSeededSqliteFixture } from "../support/sqlite-fixture";

function buildSamples(
  count: number,
  options: { includeBaseline: boolean; includeCandidate: boolean }
): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, index) => {
    const sample: Record<string, unknown> = {
      sampleId: `sample-${String(index + 1).padStart(3, "0")}`,
      query: `query-${index + 1}`,
      term: "GMV"
    };
    if (options.includeBaseline) {
      sample.baselineSelectedContextHit = index % 2 === 0;
    }
    if (options.includeCandidate) {
      sample.glossarySelectedContextHit = index % 3 !== 0;
    }
    return sample;
  });
}

describe("glossary selected_context gate integration", () => {
  let app: INestApplication;
  let quality: RagQualityService;
  let cleanupFixture: (() => Promise<void>) | undefined;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    const fixture = await createSeededSqliteFixture("glossary-selected-context-gate");
    cleanupFixture = fixture.cleanup;
    process.env.SQLITE_PATH = fixture.dbPath;
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.LLM_MOCK_MODE = "true";

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    quality = app.get(RagQualityService);
  });

  afterAll(async () => {
    await app.close();
    if (cleanupFixture) {
      await cleanupFixture();
    }
  });

  beforeEach(() => {
    quality.reset();
    delete process.env.GLOSSARY_SELECTED_CONTEXT_FIXTURE_PATH;
  });

  afterEach(() => {
    delete process.env.GLOSSARY_SELECTED_CONTEXT_FIXTURE_PATH;
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (!dir) {
        continue;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns pass when fixture has >=100 samples and relative lift >=20%", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/rag/quality/report")
      .send();
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.data.glossarySelectedContext.status).toBe("pass");
    expect(res.body.data.glossarySelectedContext.pass).toBe(true);
    expect(res.body.data.glossarySelectedContext.sampleSize).toBe(100);
    expect(res.body.data.glossarySelectedContext.relativeLift).toBeGreaterThanOrEqual(0.2);
    expect(res.body.data.glossarySelectedContext.sampleVersion).toBe(
      "2026-04-18-glossary-selected-context-v1"
    );

    const gateRes = await request(app.getHttpServer())
      .get("/api/v1/rag/quality/report/glossary-selected-context")
      .send();
    expect(gateRes.status).toBe(200);
    expect(gateRes.body.status).toBe("success");
    expect(gateRes.body.data.status).toBe("pass");
  });

  it("returns sample_not_ready when fixture has insufficient samples", async () => {
    const dir = mkdtempSync(join(tmpdir(), "glossary-gate-"));
    tempDirs.push(dir);
    const fixturePath = join(dir, "samples.json");
    writeFileSync(
      fixturePath,
      JSON.stringify({
        version: "fixture-insufficient",
        baselineRunId: "run-baseline-insufficient",
        candidateRunId: "run-candidate-insufficient",
        samples: buildSamples(20, { includeBaseline: true, includeCandidate: true })
      }),
      "utf-8"
    );
    process.env.GLOSSARY_SELECTED_CONTEXT_FIXTURE_PATH = fixturePath;

    const res = await request(app.getHttpServer())
      .get("/api/v1/rag/quality/report")
      .send();
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.data.glossarySelectedContext.status).toBe("sample_not_ready");
    expect(res.body.data.glossarySelectedContext.reasons).toEqual(
      expect.arrayContaining(["sample_count_below_minimum"])
    );
  });

  it("returns sample_not_ready when baseline lane is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "glossary-gate-"));
    tempDirs.push(dir);
    const fixturePath = join(dir, "samples.json");
    writeFileSync(
      fixturePath,
      JSON.stringify({
        version: "fixture-missing-baseline",
        baselineRunId: "run-baseline-missing",
        candidateRunId: "run-candidate-ready",
        samples: buildSamples(100, { includeBaseline: false, includeCandidate: true })
      }),
      "utf-8"
    );
    process.env.GLOSSARY_SELECTED_CONTEXT_FIXTURE_PATH = fixturePath;

    const res = await request(app.getHttpServer())
      .get("/api/v1/rag/quality/report")
      .send();
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.data.glossarySelectedContext.status).toBe("sample_not_ready");
    expect(res.body.data.glossarySelectedContext.reasons).toEqual(
      expect.arrayContaining(["baseline_not_ready"])
    );
  });

  it("returns controlled error when fixture JSON is malformed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "glossary-gate-"));
    tempDirs.push(dir);
    const fixturePath = join(dir, "samples.json");
    writeFileSync(fixturePath, "{ invalid-json", "utf-8");
    process.env.GLOSSARY_SELECTED_CONTEXT_FIXTURE_PATH = fixturePath;

    const res = await request(app.getHttpServer())
      .get("/api/v1/rag/quality/report")
      .send();
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.data.glossarySelectedContext.status).toBe("error");
    expect(res.body.data.glossarySelectedContext.pass).toBe(false);
    expect(res.body.data.glossarySelectedContext.reasons).toEqual(
      expect.arrayContaining(["fixture_parse_failed"])
    );
  });
});
