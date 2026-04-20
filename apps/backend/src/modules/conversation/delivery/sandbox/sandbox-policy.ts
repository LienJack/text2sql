import { resolve, sep } from "node:path";

export const DELIVERY_SANDBOX_POLICY_VERSION = "2026-04-18.r29.v1";

export interface DeliverySandboxNetworkRule {
  host: string;
  protocols?: Array<"http" | "https">;
  ports?: number[];
}

export interface DeliverySandboxPolicy {
  policyId: "delivery.postprocess.sandbox";
  version: typeof DELIVERY_SANDBOX_POLICY_VERSION;
  defaultAction: "deny";
  outboundNetwork: {
    denyByDefault: true;
    allowlist: DeliverySandboxNetworkRule[];
  };
  filesystemWrite: {
    denyByDefault: true;
    allowlist: string[];
  };
  processSpawn: {
    denyByDefault: true;
    allowlist: string[];
  };
}

export interface DeliverySandboxPolicyOverrides {
  outboundNetworkAllowlist?: DeliverySandboxNetworkRule[];
  filesystemWriteAllowlist?: string[];
  processSpawnAllowlist?: string[];
}

export const DEFAULT_DELIVERY_SANDBOX_POLICY: DeliverySandboxPolicy = {
  policyId: "delivery.postprocess.sandbox",
  version: DELIVERY_SANDBOX_POLICY_VERSION,
  defaultAction: "deny",
  outboundNetwork: {
    denyByDefault: true as const,
    allowlist: []
  },
  filesystemWrite: {
    denyByDefault: true as const,
    allowlist: []
  },
  processSpawn: {
    denyByDefault: true as const,
    allowlist: []
  }
};

export function createDeliverySandboxPolicy(
  overrides: DeliverySandboxPolicyOverrides = {}
): DeliverySandboxPolicy {
  return {
    ...DEFAULT_DELIVERY_SANDBOX_POLICY,
    outboundNetwork: {
      denyByDefault: true as const,
      allowlist: overrides.outboundNetworkAllowlist ?? []
    },
    filesystemWrite: {
      denyByDefault: true as const,
      allowlist: overrides.filesystemWriteAllowlist ?? []
    },
    processSpawn: {
      denyByDefault: true as const,
      allowlist: overrides.processSpawnAllowlist ?? []
    }
  };
}

export function isSandboxNetworkAllowed(
  policy: DeliverySandboxPolicy,
  target: {
    host: string;
    protocol?: string;
    port?: number;
  }
): boolean {
  if (!policy.outboundNetwork.denyByDefault) {
    return true;
  }
  if (policy.outboundNetwork.allowlist.length === 0) {
    return false;
  }

  const host = normalizeString(target.host)?.toLowerCase();
  if (!host) {
    return false;
  }
  const protocol = normalizeString(target.protocol)?.toLowerCase();

  for (const rule of policy.outboundNetwork.allowlist) {
    const ruleHost = normalizeString(rule.host)?.toLowerCase();
    if (!ruleHost) {
      continue;
    }
    const hostMatch = host === ruleHost || host.endsWith(`.${ruleHost}`);
    if (!hostMatch) {
      continue;
    }

    if (rule.protocols && rule.protocols.length > 0) {
      if (!protocol || !rule.protocols.includes(protocol as "http" | "https")) {
        continue;
      }
    }

    if (rule.ports && rule.ports.length > 0) {
      if (typeof target.port !== "number" || !rule.ports.includes(target.port)) {
        continue;
      }
    }
    return true;
  }

  return false;
}

export function isSandboxFilesystemWriteAllowed(
  policy: DeliverySandboxPolicy,
  filePath: string
): boolean {
  if (!policy.filesystemWrite.denyByDefault) {
    return true;
  }
  if (policy.filesystemWrite.allowlist.length === 0) {
    return false;
  }

  const normalizedPath = resolve(filePath);
  for (const allowRoot of policy.filesystemWrite.allowlist) {
    const normalizedRoot = resolve(allowRoot);
    if (
      normalizedPath === normalizedRoot ||
      normalizedPath.startsWith(`${normalizedRoot}${sep}`)
    ) {
      return true;
    }
  }

  return false;
}

export function isSandboxProcessSpawnAllowed(
  policy: DeliverySandboxPolicy,
  command: string
): boolean {
  if (!policy.processSpawn.denyByDefault) {
    return true;
  }
  const normalizedCommand = normalizeString(command)?.toLowerCase();
  if (!normalizedCommand) {
    return false;
  }
  if (policy.processSpawn.allowlist.length === 0) {
    return false;
  }

  return policy.processSpawn.allowlist.some(
    (item) => normalizeString(item)?.toLowerCase() === normalizedCommand
  );
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
