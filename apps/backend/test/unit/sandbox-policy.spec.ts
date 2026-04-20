import { join } from "node:path";
import {
  DELIVERY_SANDBOX_POLICY_VERSION,
  DEFAULT_DELIVERY_SANDBOX_POLICY,
  createDeliverySandboxPolicy,
  isSandboxFilesystemWriteAllowed,
  isSandboxNetworkAllowed,
  isSandboxProcessSpawnAllowed
} from "../../src/modules/conversation/delivery/sandbox/sandbox-policy";

describe("delivery sandbox policy", () => {
  it("is explicit, versioned, and deny-by-default", () => {
    expect(DEFAULT_DELIVERY_SANDBOX_POLICY.policyId).toBe(
      "delivery.postprocess.sandbox"
    );
    expect(DEFAULT_DELIVERY_SANDBOX_POLICY.version).toBe(
      DELIVERY_SANDBOX_POLICY_VERSION
    );
    expect(DEFAULT_DELIVERY_SANDBOX_POLICY.defaultAction).toBe("deny");
    expect(DEFAULT_DELIVERY_SANDBOX_POLICY.outboundNetwork.denyByDefault).toBe(
      true
    );
    expect(DEFAULT_DELIVERY_SANDBOX_POLICY.filesystemWrite.denyByDefault).toBe(
      true
    );
    expect(DEFAULT_DELIVERY_SANDBOX_POLICY.processSpawn.denyByDefault).toBe(true);
  });

  it("denies outbound network/process/file-write by default", () => {
    expect(
      isSandboxNetworkAllowed(DEFAULT_DELIVERY_SANDBOX_POLICY, {
        host: "example.com",
        protocol: "https",
        port: 443
      })
    ).toBe(false);
    expect(
      isSandboxFilesystemWriteAllowed(
        DEFAULT_DELIVERY_SANDBOX_POLICY,
        join(process.cwd(), "tmp", "sandbox.out")
      )
    ).toBe(false);
    expect(
      isSandboxProcessSpawnAllowed(DEFAULT_DELIVERY_SANDBOX_POLICY, "node")
    ).toBe(false);
  });

  it("allows only explicit allowlist entries", () => {
    const policy = createDeliverySandboxPolicy({
      outboundNetworkAllowlist: [
        {
          host: "internal.example.com",
          protocols: ["https"],
          ports: [443]
        }
      ],
      filesystemWriteAllowlist: [join(process.cwd(), "data", "sandbox-output")],
      processSpawnAllowlist: ["node"]
    });

    expect(
      isSandboxNetworkAllowed(policy, {
        host: "internal.example.com",
        protocol: "https",
        port: 443
      })
    ).toBe(true);
    expect(
      isSandboxNetworkAllowed(policy, {
        host: "internal.example.com",
        protocol: "http",
        port: 80
      })
    ).toBe(false);

    expect(
      isSandboxFilesystemWriteAllowed(
        policy,
        join(process.cwd(), "data", "sandbox-output", "artifact.json")
      )
    ).toBe(true);
    expect(
      isSandboxFilesystemWriteAllowed(policy, join(process.cwd(), "tmp", "artifact.json"))
    ).toBe(false);

    expect(isSandboxProcessSpawnAllowed(policy, "node")).toBe(true);
    expect(isSandboxProcessSpawnAllowed(policy, "bash")).toBe(false);
  });
});
