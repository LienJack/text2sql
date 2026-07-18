export type PreparedArtifactPayload = {
  serializedPayload: string;
  digest: string;
  sizeBytes: number;
};

export type ArtifactPayloadReadResult =
  | {
      available: true;
      payload: Record<string, unknown>;
      digest: string;
      sizeBytes: number;
      expiresAt?: string | null;
    }
  | {
      available: false;
      reason: "not_found" | "expired" | "digest_mismatch" | "deleted";
      digest?: string;
      sizeBytes?: number;
      expiresAt?: string | null;
    };

export abstract class ArtifactPayloadStorePort {
  abstract prepare(payload: Record<string, unknown>): PreparedArtifactPayload;

  abstract assertTaskCapacity(taskId: string, incomingBytes: number): Promise<void>;

  abstract read(artifactId: string): Promise<ArtifactPayloadReadResult>;

  abstract purgeExpired(now?: Date): Promise<number>;
}
