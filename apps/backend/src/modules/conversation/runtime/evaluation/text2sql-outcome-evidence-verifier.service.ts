import { Injectable } from "@nestjs/common";
import { createPublicKey, verify } from "node:crypto";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { AppConfigService } from "../../../config/app-config.service";
import {
  TEXT2SQL_ACCURACY_VERSION_KEYS,
  type Text2SqlAccuracyTrialEvidence,
  type Text2SqlAccuracyVersionTuple,
  type Text2SqlOutcomeTrialPayload
} from "./text2sql-accuracy-evaluation.service";

export interface Text2SqlSignedOutcomeEvidenceEnvelope {
  version: "text2sql-outcome-evidence/v1";
  keyId: string;
  evidenceId: string;
  issuedAt: string;
  expiresAt: string;
  payload: Text2SqlOutcomeTrialPayload;
  signature: string;
}

export interface Text2SqlOutcomeEvidenceBinding {
  sliceId: string;
  caseId: string;
  role: "baseline" | "candidate";
  trialId: string;
  fixtureDigest: string;
  questionDigest: string;
  queryContractDigest: string;
  versions: Text2SqlAccuracyVersionTuple;
}

type UnsignedOutcomeEvidenceEnvelope = Omit<
  Text2SqlSignedOutcomeEvidenceEnvelope,
  "signature"
>;

const sortForCanonicalJson = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => sortForCanonicalJson(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortForCanonicalJson(item)])
    );
  }
  return value;
};

export const canonicalizeOutcomeEvidenceEnvelope = (
  envelope: UnsignedOutcomeEvidenceEnvelope
): string => JSON.stringify(sortForCanonicalJson(envelope));

@Injectable()
export class Text2SqlOutcomeEvidenceVerifierService {
  constructor(private readonly config: AppConfigService) {}

  verifyEnvelope(
    envelope: Text2SqlSignedOutcomeEvidenceEnvelope,
    expected: Text2SqlOutcomeEvidenceBinding & { now?: Date }
  ): Text2SqlAccuracyTrialEvidence {
    const reasons: string[] = [];
    const now = expected.now ?? new Date();
    const publicKeyPem = this.config.text2sqlAccuracyTrustedPublicKeys[envelope.keyId];

    if (envelope.version !== "text2sql-outcome-evidence/v1") {
      reasons.push("evidence_envelope_version_unsupported");
    }
    if (!publicKeyPem) {
      reasons.push("signing_key_untrusted");
    } else if (!this.signatureValid(envelope, publicKeyPem)) {
      reasons.push("signature_invalid");
    }
    if (
      envelope.evidenceId !== envelope.payload.evidenceId ||
      envelope.issuedAt !== envelope.payload.issuedAt
    ) {
      reasons.push("envelope_payload_identity_mismatch");
    }
    if (envelope.payload.trialId !== expected.trialId) {
      reasons.push("trial_id_mismatch");
    }
    if (
      envelope.payload.sliceId !== expected.sliceId ||
      envelope.payload.caseId !== expected.caseId ||
      envelope.payload.role !== expected.role
    ) {
      reasons.push("trial_scope_mismatch");
    }
    if (envelope.payload.fixtureDigest !== expected.fixtureDigest) {
      reasons.push("fixture_digest_mismatch");
    }
    if (
      envelope.payload.questionDigest !== expected.questionDigest ||
      envelope.payload.queryContractDigest !== expected.queryContractDigest
    ) {
      reasons.push("trial_contract_digest_mismatch");
    }
    if (
      TEXT2SQL_ACCURACY_VERSION_KEYS.some(
        (key) => envelope.payload.versions[key] !== expected.versions[key]
      )
    ) {
      reasons.push("version_tuple_mismatch");
    }

    const issuedAtMs = Date.parse(envelope.issuedAt);
    const expiresAtMs = Date.parse(envelope.expiresAt);
    if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs)) {
      reasons.push("evidence_time_invalid");
    } else {
      if (expiresAtMs <= now.getTime() || expiresAtMs <= issuedAtMs) {
        reasons.push("evidence_expired");
      }
      if (
        issuedAtMs > now.getTime() ||
        now.getTime() - issuedAtMs > this.config.text2sqlAccuracyEvidenceMaxAgeMs
      ) {
        reasons.push("evidence_outside_trust_window");
      }
    }

    return {
      trust: "signed-real",
      verified: reasons.length === 0,
      reasonCodes: reasons,
      payload: envelope.payload
    };
  }

  async resolveFixturePath(relativePath: string): Promise<string> {
    if (!relativePath.trim() || isAbsolute(relativePath)) {
      throw new Error("fixture_path_outside_root");
    }
    const root = await realpath(this.config.text2sqlAccuracyFixtureRoot);
    const lexicalCandidate = resolve(root, relativePath);
    if (!this.isWithin(root, lexicalCandidate)) {
      throw new Error("fixture_path_outside_root");
    }
    let resolvedCandidate: string;
    try {
      resolvedCandidate = await realpath(lexicalCandidate);
    } catch {
      throw new Error("fixture_path_unavailable");
    }
    if (!this.isWithin(root, resolvedCandidate)) {
      throw new Error("fixture_path_outside_root");
    }
    return resolvedCandidate;
  }

  private signatureValid(
    envelope: Text2SqlSignedOutcomeEvidenceEnvelope,
    publicKeyPem: string
  ): boolean {
    try {
      const { signature, ...unsigned } = envelope;
      return verify(
        null,
        Buffer.from(canonicalizeOutcomeEvidenceEnvelope(unsigned)),
        createPublicKey(publicKeyPem),
        Buffer.from(signature, "base64")
      );
    } catch {
      return false;
    }
  }

  private isWithin(root: string, candidate: string): boolean {
    const pathFromRoot = relative(root, candidate);
    return (
      pathFromRoot === "" ||
      (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot))
    );
  }
}
