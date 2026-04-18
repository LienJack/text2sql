import type { DeliveryArtifactLayer } from "@text2sql/shared-types";
import { createDeliverySandboxPolicy } from "../../src/modules/delivery/sandbox/sandbox-policy";
import { SandboxRuntimeService } from "../../src/modules/delivery/sandbox/sandbox-runtime.service";

const buildArtifact = (): DeliveryArtifactLayer => ({
  sql: "SELECT id, status FROM orders LIMIT 10",
  columns: ["id", "status"],
  rowCount: 3,
  rowsPreview: [
    { id: 1, status: "paid" },
    { id: 2, status: "pending" },
    { id: 3, status: "closed" }
  ],
  hasError: false
});

describe("sandbox isolation integration", () => {
  it("blocks network, file write, and process spawn under deny-by-default policy", () => {
    const runtime = new SandboxRuntimeService();

    const networkDenied = runtime.executeArtifactPostProcess({
      artifact: buildArtifact(),
      request: {
        operations: [
          {
            type: "network_request",
            host: "example.com",
            protocol: "https",
            port: 443
          }
        ]
      }
    });
    expect(networkDenied.ok).toBe(false);
    if (!networkDenied.ok) {
      expect(networkDenied.riskTags).toContain("sandbox_network_denied");
    }

    const fileDenied = runtime.executeArtifactPostProcess({
      artifact: buildArtifact(),
      request: {
        operations: [{ type: "file_write", path: "/tmp/sandbox-artifact.json" }]
      }
    });
    expect(fileDenied.ok).toBe(false);
    if (!fileDenied.ok) {
      expect(fileDenied.riskTags).toContain("sandbox_filesystem_denied");
    }

    const processDenied = runtime.executeArtifactPostProcess({
      artifact: buildArtifact(),
      request: {
        operations: [{ type: "process_spawn", command: "node" }]
      }
    });
    expect(processDenied.ok).toBe(false);
    if (!processDenied.ok) {
      expect(processDenied.riskTags).toContain("sandbox_process_denied");
    }
  });

  it("permits only allowlisted operations and applies safe artifact post-processing", () => {
    const policy = createDeliverySandboxPolicy({
      outboundNetworkAllowlist: [
        {
          host: "internal.example.com",
          protocols: ["https"],
          ports: [443]
        }
      ],
      filesystemWriteAllowlist: ["/tmp/sandbox-output"],
      processSpawnAllowlist: ["node"]
    });
    const runtime = new SandboxRuntimeService(policy);

    const result = runtime.executeArtifactPostProcess({
      artifact: buildArtifact(),
      request: {
        policyVersion: policy.version,
        operations: [
          {
            type: "network_request",
            host: "internal.example.com",
            protocol: "https",
            port: 443
          },
          {
            type: "file_write",
            path: "/tmp/sandbox-output/artifact.json"
          },
          {
            type: "process_spawn",
            command: "node"
          },
          {
            type: "rows_preview_limit",
            maxRows: 1
          }
        ]
      }
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.artifact.rowsPreview).toHaveLength(1);
      expect(result.artifact.rowCount).toBe(3);
    }
  });
});
