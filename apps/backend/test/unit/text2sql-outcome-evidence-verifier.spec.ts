import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppConfigService } from "../../src/modules/config/app-config.service";
import {
  Text2SqlOutcomeEvidenceVerifierService,
  canonicalizeOutcomeEvidenceEnvelope
} from "../../src/modules/conversation/runtime/evaluation/text2sql-outcome-evidence-verifier.service";
import type { Text2SqlOutcomeTrialPayload } from "../../src/modules/conversation/runtime/evaluation/text2sql-accuracy-evaluation.service";

const payload: Text2SqlOutcomeTrialPayload = {
  version: "text2sql-outcome-trial/v1",
  evidenceId: "evidence-1",
  trialId: "trial-1",
  sliceId: "slice-1",
  caseId: "case-1",
  role: "candidate",
  mode: "enforce",
  versions: {
    questionSet: "questions-v1",
    semantic: "semantic-v1",
    schema: "schema-v1",
    policy: "policy-v1",
    data: "data-v1",
    model: "model-v1",
    prompt: "prompt-v1",
    workflow: "workflow-v1",
    code: "code-v1"
  },
  questionDigest: "question-digest",
  fixtureDigest: "fixture-digest",
  queryContractDigest: "contract-digest",
  outcome: {
    passed: true,
    executionSucceeded: true,
    latencyMs: 120,
    oracleVerdicts: [
      {
        oracleId: "golden-result",
        kind: "golden_result",
        mandatory: true,
        passed: true
      }
    ]
  },
  safety: {
    unauthorizedSqlCount: 0,
    hardGateFalsePassCount: 0,
    outOfBoundRepairCount: 0
  },
  issuedAt: "2026-07-17T01:00:00.000Z"
};

describe("Text2SqlOutcomeEvidenceVerifierService", () => {
  const keyPair = generateKeyPairSync("ed25519");
  const publicKey = keyPair.publicKey.export({ type: "spki", format: "pem" }).toString();
  const config = {
    text2sqlAccuracyTrustedPublicKeys: { "release-key": publicKey },
    text2sqlAccuracyFixtureRoot: "/tmp/text2sql-accuracy-fixtures",
    text2sqlAccuracyEvidenceMaxAgeMs: 60 * 60 * 1000
  } as unknown as AppConfigService;
  const verifier = new Text2SqlOutcomeEvidenceVerifierService(config);
  const binding = {
    sliceId: payload.sliceId,
    caseId: payload.caseId,
    role: payload.role,
    trialId: payload.trialId,
    fixtureDigest: payload.fixtureDigest,
    questionDigest: payload.questionDigest,
    queryContractDigest: payload.queryContractDigest,
    versions: payload.versions
  };

  function signedEnvelope(overrides: Record<string, unknown> = {}) {
    const unsigned = {
      version: "text2sql-outcome-evidence/v1" as const,
      keyId: "release-key",
      evidenceId: payload.evidenceId,
      issuedAt: payload.issuedAt,
      expiresAt: "2026-07-17T02:00:00.000Z",
      payload,
      ...overrides
    };
    return {
      ...unsigned,
      signature: sign(
        null,
        Buffer.from(canonicalizeOutcomeEvidenceEnvelope(unsigned)),
        keyPair.privateKey
      ).toString("base64")
    };
  }

  it("accepts a trusted signature bound to the expected Trial and version digests", () => {
    const result = verifier.verifyEnvelope(signedEnvelope(), {
      ...binding,
      now: new Date("2026-07-17T01:30:00.000Z")
    });

    expect(result.verified).toBe(true);
    expect(result.reasonCodes).toEqual([]);
    expect(result.payload).toEqual(payload);
  });

  it("rejects payload tampering and cross-Trial replay", () => {
    const envelope = signedEnvelope();
    const tampered = {
      ...envelope,
      payload: { ...payload, trialId: "trial-2" }
    };

    expect(
      verifier.verifyEnvelope(tampered, {
        ...binding,
        now: new Date("2026-07-17T01:30:00.000Z"),
        trialId: "trial-2"
      }).reasonCodes
    ).toContain("signature_invalid");

    expect(
      verifier.verifyEnvelope(envelope, {
        ...binding,
        now: new Date("2026-07-17T01:30:00.000Z"),
        trialId: "another-trial"
      }).reasonCodes
    ).toContain("trial_id_mismatch");
  });

  it("keeps fixture paths inside the canonical root, including symlinks", async () => {
    const root = await mkdtemp(join(tmpdir(), "text2sql-accuracy-root-"));
    const outside = await mkdtemp(join(tmpdir(), "text2sql-accuracy-outside-"));
    await mkdir(join(root, "slice"));
    await writeFile(join(root, "slice", "fixture.json"), "{}");
    await writeFile(join(outside, "secret.json"), "{}");
    await symlink(join(outside, "secret.json"), join(root, "slice", "escape.json"));

    const scopedVerifier = new Text2SqlOutcomeEvidenceVerifierService({
      ...config,
      text2sqlAccuracyFixtureRoot: root
    } as unknown as AppConfigService);

    await expect(
      scopedVerifier.resolveFixturePath("slice/fixture.json")
    ).resolves.toBe(await realpath(join(root, "slice", "fixture.json")));
    await expect(scopedVerifier.resolveFixturePath("../secret.json")).rejects.toThrow(
      "fixture_path_outside_root"
    );
    await expect(scopedVerifier.resolveFixturePath("slice/escape.json")).rejects.toThrow(
      "fixture_path_outside_root"
    );
  });
});
