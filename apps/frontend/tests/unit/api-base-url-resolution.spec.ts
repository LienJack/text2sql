import { afterEach, describe, expect, it, vi } from "vitest";

function mockApiResponse(data: unknown): Response {
  return new Response(JSON.stringify({ status: "success", data }), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}

async function loadClientsWithApiBase(
  apiBase: string | undefined
): Promise<{
  apiClient: typeof import("@/lib/api-client");
  adminApiClient: typeof import("@/lib/admin-api-client");
  settingsApiClient: typeof import("@/lib/settings-api-client");
}> {
  vi.resetModules();
  if (apiBase === undefined) {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
  } else {
    process.env.NEXT_PUBLIC_API_BASE_URL = apiBase;
  }

  return {
    apiClient: await import("@/lib/api-client"),
    adminApiClient: await import("@/lib/admin-api-client"),
    settingsApiClient: await import("@/lib/settings-api-client")
  };
}

describe("API base URL resolution", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
  });

  it("uses same-origin relative paths by default across all clients", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockApiResponse([]))
      .mockResolvedValueOnce(mockApiResponse({ id: "ws-1", name: "Workspace A" }))
      .mockResolvedValueOnce(mockApiResponse({ providers: [], models: [] }))
      .mockResolvedValueOnce(mockApiResponse({ status: "ok" }));
    vi.stubGlobal("fetch", fetchMock);

    const { apiClient, adminApiClient, settingsApiClient } =
      await loadClientsWithApiBase(undefined);

    await apiClient.listDatasources();
    await adminApiClient.createWorkspace({ name: "Workspace A" });
    await settingsApiClient.fetchSettingsView();
    await settingsApiClient.fetchBackendHealthSnapshot();

    const requestedUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(requestedUrls).toEqual([
      "/api/v1/datasources",
      "/api/v1/system/workspaces",
      "/api/v1/settings/models",
      "/api/health"
    ]);
  });

  it("normalizes override base composition without duplicate /api or double slashes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockApiResponse([]))
      .mockResolvedValueOnce(mockApiResponse({ id: "ws-1", name: "Workspace A" }))
      .mockResolvedValueOnce(mockApiResponse({ providers: [], models: [] }))
      .mockResolvedValueOnce(mockApiResponse({ status: "ok" }));
    vi.stubGlobal("fetch", fetchMock);

    const { apiClient, adminApiClient, settingsApiClient } =
      await loadClientsWithApiBase("http://gateway.local/api/");

    await apiClient.listDatasources();
    await adminApiClient.createWorkspace({ name: "Workspace A" });
    await settingsApiClient.fetchSettingsView();
    await settingsApiClient.fetchBackendHealthSnapshot();

    const requestedUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(requestedUrls).toEqual([
      "http://gateway.local/api/v1/datasources",
      "http://gateway.local/api/v1/system/workspaces",
      "http://gateway.local/api/v1/settings/models",
      "http://gateway.local/api/health"
    ]);
  });
});
