#!/usr/bin/env node

const BASE_URL = (process.env.NGINX_GATEWAY_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const BACKEND_HEALTH_URL = (
  process.env.BACKEND_HEALTH_URL || "http://localhost:3002/health"
).replace(/\/+$/, "");
const USER_ID = process.env.SMOKE_USER_ID || "user_system_admin";
const USER_ROLE = process.env.SMOKE_USER_ROLE || "admin";
const EXPLICIT_WORKSPACE_ID = process.env.SMOKE_WORKSPACE_ID?.trim() || "";
const parsedBaseline = Number.parseInt(
  process.env.SMOKE_BASELINE_FIRST_SUCCESS_SESSION_MS || "",
  10
);
const BASELINE_FIRST_SUCCESS_SESSION_MS =
  Number.isFinite(parsedBaseline) && parsedBaseline > 0 ? parsedBaseline : null;
const SCRIPT_STARTED_AT = Date.now();

const FETCH_TIMEOUT_MS = 12_000;
const STREAM_FIRST_EVENT_TIMEOUT_MS = 20_000;

const failures = [];

const logPass = (scope, detail) => {
  console.log(`[PASS] ${scope}: ${detail}`);
};

const logInfo = (detail) => {
  console.log(`[INFO] ${detail}`);
};

const logMetric = (name, value) => {
  console.log(`[METRIC] ${name}=${value}`);
};

const addFailure = (scope, detail) => {
  const message = `${scope}: ${detail}`;
  failures.push(message);
  console.error(`[FAIL] ${message}`);
};

const describeError = (error) => {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const causeCode = error.cause && typeof error.cause === "object" && "code" in error.cause
    ? error.cause.code
    : undefined;
  if (typeof causeCode === "string" && causeCode) {
    return `${error.message} (${causeCode})`;
  }
  return error.message;
};

const clip = (input, max = 280) => {
  if (!input) {
    return "";
  }
  const normalized = String(input).replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}...`;
};

const defaultHeaders = (workspaceId) => {
  const headers = {
    "Accept": "application/json",
    "x-user-id": USER_ID,
    "x-user-role": USER_ROLE
  };
  if (workspaceId) {
    headers["x-workspace-id"] = workspaceId;
  }
  return headers;
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
};

const parseJsonText = (text) => {
  if (!text || !text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const parseApiError = (status, bodyText) => {
  const parsed = parseJsonText(bodyText);
  if (parsed && parsed.status === "error" && parsed.error) {
    const code = parsed.error.code || "UNKNOWN";
    const message = parsed.error.message || "unknown error";
    return `${status} ${code}: ${message}`;
  }
  return `${status}: ${clip(bodyText || "<empty response>")}`;
};

const formatMs = (value) => `${value}ms (${(value / 1000).toFixed(2)}s)`;

const STREAM_EVENT_TYPES = new Set([
  "start",
  "text-delta",
  "tool-call",
  "tool-result",
  "tool-error",
  "state",
  "finish",
  "error"
]);

const ensureSseResponse = async (response) => {
  const contentType = response.headers.get("content-type") || "";
  if (response.status !== 200) {
    const bodyText = await response.text();
    throw new Error(`expected 200, got ${parseApiError(response.status, bodyText)}`);
  }
  if (!contentType.toLowerCase().includes("text/event-stream")) {
    const bodyText = await response.text();
    throw new Error(
      `expected text/event-stream, got "${contentType || "unknown"}", body=${clip(bodyText)}`
    );
  }
};

const parseFirstSseEvent = (chunk) => {
  const blocks = String(chunk)
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (blocks.length === 0) {
    throw new Error("missing SSE block in first chunk");
  }
  const firstBlock = blocks[0];
  const lines = firstBlock
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const eventLine = lines.find((line) => line.startsWith("event:"));
  const dataLines = lines.filter((line) => line.startsWith("data:"));
  if (!eventLine || dataLines.length === 0) {
    throw new Error(`invalid SSE block format: ${clip(firstBlock)}`);
  }
  const eventType = eventLine.replace(/^event:\s*/, "").trim();
  const payloadText = dataLines
    .map((line) => line.replace(/^data:\s*/, ""))
    .join("\n");
  let payload;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    throw new Error(`invalid SSE JSON payload: ${clip(payloadText)}`);
  }
  return {
    eventType,
    payload
  };
};

const readFirstStreamChunk = async (response, timeoutMs = STREAM_FIRST_EVENT_TIMEOUT_MS) => {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("response body is not a readable stream");
  }

  const readPromise = reader.read();
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms waiting first SSE event`)), timeoutMs);
  });

  const result = await Promise.race([readPromise, timeoutPromise]);
  if (!result || typeof result !== "object" || result.done || !result.value?.length) {
    throw new Error("stream ended before first SSE chunk");
  }

  await reader.cancel();
  return Buffer.from(result.value).toString("utf8");
};

const resolveWorkspaceId = async () => {
  if (EXPLICIT_WORKSPACE_ID) {
    logInfo(`using explicit workspace id from SMOKE_WORKSPACE_ID=${EXPLICIT_WORKSPACE_ID}`);
    return EXPLICIT_WORKSPACE_ID;
  }

  try {
    const response = await fetchWithTimeout(
      `${BASE_URL}/api/v1/system/workspaces`,
      {
        method: "GET",
        headers: defaultHeaders("")
      }
    );
    const bodyText = await response.text();
    const parsed = parseJsonText(bodyText);
    const items = parsed?.status === "success" ? parsed?.data?.items : null;
    const workspaceId = Array.isArray(items) && items[0]?.id ? String(items[0].id) : "";

    if (response.ok && workspaceId) {
      logInfo(`resolved workspace id from /api/v1/system/workspaces: ${workspaceId}`);
      return workspaceId;
    }

    const fallback = "workspace_default";
    logInfo(
      `could not resolve workspace id from API (${parseApiError(response.status, bodyText)}), fallback to ${fallback}`
    );
    return fallback;
  } catch (error) {
    const fallback = "workspace_default";
    logInfo(
      `workspace discovery request failed (${describeError(error)}), fallback to ${fallback}`
    );
    return fallback;
  }
};

const checkFrontend = async () => {
  try {
    const startedAt = Date.now();
    const response = await fetchWithTimeout(`${BASE_URL}/`, {
      method: "GET",
      headers: {
        "Accept": "text/html"
      }
    });

    const contentType = response.headers.get("content-type") || "";
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`expected 2xx, got ${response.status}, body=${clip(body)}`);
    }
    if (!contentType.toLowerCase().includes("text/html")) {
      throw new Error(`expected text/html, got "${contentType || "unknown"}"`);
    }
    const body = await response.text();
    if (!/<html[\s>]/i.test(body)) {
      throw new Error("expected HTML document body containing <html>");
    }

    logPass(
      "frontend upstream",
      `GET / -> ${response.status} (${contentType}), latency=${formatMs(Date.now() - startedAt)}`
    );
  } catch (error) {
    addFailure(
      "frontend upstream",
      describeError(error)
    );
  }
};

const checkBackend = async (workspaceId) => {
  try {
    const startedAt = Date.now();
    const response = await fetchWithTimeout(
      `${BASE_URL}/api/v1/datasources`,
      {
        method: "GET",
        headers: defaultHeaders(workspaceId)
      }
    );
    const bodyText = await response.text();
    const parsed = parseJsonText(bodyText);

    if (!response.ok) {
      throw new Error(parseApiError(response.status, bodyText));
    }
    if (!parsed || parsed.status !== "success" || !Array.isArray(parsed.data)) {
      throw new Error(`invalid success payload: ${clip(bodyText)}`);
    }
    const invalidDatasource = parsed.data.find(
      (item) => !item || typeof item !== "object" || typeof item.id !== "string" || !item.id
    );
    if (invalidDatasource) {
      throw new Error(`invalid datasource item shape: ${clip(JSON.stringify(invalidDatasource))}`);
    }

    const firstDatasourceId = parsed.data[0]?.id ? String(parsed.data[0].id) : "";
    logPass(
      "backend upstream",
      `GET /api/v1/datasources -> ${response.status}, datasources=${parsed.data.length}, workspace=${workspaceId || "<none>"}, latency=${formatMs(Date.now() - startedAt)}`
    );
    return firstDatasourceId;
  } catch (error) {
    addFailure(
      "backend upstream",
      describeError(error)
    );
    return "";
  }
};

const checkHealth = async () => {
  try {
    const startedAt = Date.now();
    const response = await fetchWithTimeout(
      BACKEND_HEALTH_URL,
      {
        method: "GET",
        headers: defaultHeaders("")
      }
    );
    const bodyText = await response.text();
    const parsed = parseJsonText(bodyText);

    if (!response.ok) {
      throw new Error(parseApiError(response.status, bodyText));
    }
    const ragConfig = parsed?.status === "success" ? parsed?.data?.dependencies?.ragConfig : null;
    const embeddingProvider = ragConfig?.embedding?.provider;
    const rerankProvider = ragConfig?.rerank?.provider;
    if (typeof embeddingProvider !== "string" || embeddingProvider.length === 0) {
      throw new Error("health.dependencies.ragConfig.embedding.provider missing");
    }
    if (typeof rerankProvider !== "string" || rerankProvider.length === 0) {
      throw new Error("health.dependencies.ragConfig.rerank.provider missing");
    }
    logPass(
      "health",
      `GET ${BACKEND_HEALTH_URL} -> embedding=${embeddingProvider}, rerank=${rerankProvider}, latency=${formatMs(Date.now() - startedAt)}`
    );
  } catch (error) {
    addFailure("health", describeError(error));
  }
};

const tryCreateSession = async (workspaceId, datasourceId) => {
  const response = await fetchWithTimeout(
    `${BASE_URL}/api/v1/sessions`,
    {
      method: "POST",
      headers: {
        ...defaultHeaders(workspaceId),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        datasource: datasourceId,
        workspaceId
      })
    }
  );
  const bodyText = await response.text();
  const parsed = parseJsonText(bodyText);
  const sessionId = parsed?.status === "success" ? parsed?.data?.id : "";
  if (!response.ok || !sessionId) {
    throw new Error(`create session failed: ${parseApiError(response.status, bodyText)}`);
  }
  return String(sessionId);
};

const checkStream = async (workspaceId, datasourceId) => {
  let sessionId = "";
  let mode = "fallback";
  let firstSuccessSessionMs = null;

  try {
    if (datasourceId) {
      sessionId = await tryCreateSession(workspaceId, datasourceId);
      mode = "session";
      firstSuccessSessionMs = Date.now() - SCRIPT_STARTED_AT;
      logInfo(`created smoke session for stream check: ${sessionId}`);
    } else {
      sessionId = "smoke-missing-datasource";
      logInfo("no datasource available from /datasources, using stream fallback path check");
    }
  } catch (error) {
    sessionId = "smoke-session-create-failed";
    logInfo(
      `session bootstrap failed, using stream fallback path check: ${describeError(error)}`
    );
  }

  try {
    const startedAt = Date.now();
    const response = await fetchWithTimeout(
      `${BASE_URL}/api/v1/sessions/${sessionId}/messages/stream`,
      {
        method: "POST",
        headers: {
          ...defaultHeaders(workspaceId),
          "Content-Type": "application/json",
          "Accept": "text/event-stream"
        },
        body: JSON.stringify({
          message: "smoke stream ping"
        })
      },
      STREAM_FIRST_EVENT_TIMEOUT_MS + 5_000
    );

    await ensureSseResponse(response);
    const chunk = await readFirstStreamChunk(response);
    const firstEvent = parseFirstSseEvent(chunk);
    if (!STREAM_EVENT_TYPES.has(firstEvent.eventType)) {
      throw new Error(`unexpected SSE event type "${firstEvent.eventType}"`);
    }
    if (!firstEvent.payload || typeof firstEvent.payload !== "object") {
      throw new Error("first SSE payload is not an object");
    }
    if (firstEvent.payload.type !== firstEvent.eventType) {
      throw new Error(
        `event name/payload type mismatch (${firstEvent.eventType} != ${String(firstEvent.payload.type)})`
      );
    }
    if (typeof firstEvent.payload.runId !== "string" || !firstEvent.payload.runId) {
      throw new Error("first SSE payload missing runId");
    }
    if (typeof firstEvent.payload.sessionId !== "string" || !firstEvent.payload.sessionId) {
      throw new Error("first SSE payload missing sessionId");
    }
    if (mode === "session" && firstEvent.payload.sessionId !== sessionId) {
      throw new Error(
        `first SSE payload session mismatch (${firstEvent.payload.sessionId} != ${sessionId})`
      );
    }
    if (!firstEvent.payload.at || Number.isNaN(Date.parse(String(firstEvent.payload.at)))) {
      throw new Error("first SSE payload has invalid at timestamp");
    }
    if (!("data" in firstEvent.payload)) {
      throw new Error("first SSE payload missing data field");
    }

    logPass(
      "stream",
      `POST /api/v1/sessions/:id/messages/stream -> first event=${firstEvent.eventType} (${mode}), latency=${formatMs(Date.now() - startedAt)}`
    );
  } catch (error) {
    addFailure(
      "stream",
      describeError(error)
    );
  }

  return {
    firstSuccessSessionMs
  };
};

const main = async () => {
  console.log(`[INFO] base url: ${BASE_URL}`);
  console.log(`[INFO] backend health url: ${BACKEND_HEALTH_URL}`);
  console.log(`[INFO] actor: ${USER_ROLE}/${USER_ID}`);

  await checkFrontend();
  const workspaceId = await resolveWorkspaceId();
  const datasourceId = await checkBackend(workspaceId);
  await checkHealth();
  const { firstSuccessSessionMs } = await checkStream(workspaceId, datasourceId);
  if (typeof firstSuccessSessionMs === "number") {
    logMetric("first_success_session_ms", firstSuccessSessionMs);
    if (typeof BASELINE_FIRST_SUCCESS_SESSION_MS === "number") {
      const deltaMs = firstSuccessSessionMs - BASELINE_FIRST_SUCCESS_SESSION_MS;
      const percent = ((deltaMs / BASELINE_FIRST_SUCCESS_SESSION_MS) * 100).toFixed(1);
      logMetric(
        "first_success_session_vs_baseline",
        `${formatMs(firstSuccessSessionMs)} vs baseline ${formatMs(BASELINE_FIRST_SUCCESS_SESSION_MS)} (delta ${deltaMs >= 0 ? "+" : ""}${formatMs(deltaMs)}, ${percent}%)`
      );
    }
  } else {
    logInfo("first-success-session metric unavailable (session creation did not succeed in this run)");
  }

  if (failures.length > 0) {
    console.error("\nSmoke check failed:");
    for (const item of failures) {
      console.error(`- ${item}`);
    }
    process.exit(1);
  }

  console.log("\nSmoke check passed: unified 3000 entry is healthy for page/api/stream.");
};

main().catch((error) => {
  addFailure("smoke runner", describeError(error));
  console.error("\nSmoke check failed unexpectedly.");
  process.exit(1);
});
