# LLM Stream & Tool Calling Migration Spec

## Scope

- Backend LLM gateway migrates to Vercel AI SDK core (`ai` + `@ai-sdk/openai-compatible`).
- Chat primary request path supports SSE streaming endpoint.
- Tool Calling baseline is enabled with allowlisted server-side tools.

## API Changes

### New Endpoint

- `POST /api/v1/sessions/:sessionId/messages/stream`
- Response content type: `text/event-stream`
- Event types:
  - `start`
  - `text-delta`
  - `tool-call`
  - `tool-result`
  - `tool-error`
  - `finish`
  - `error`

### Existing Endpoint Compatibility

- `POST /api/v1/sessions/:sessionId/messages` remains available.
- Existing response shape stays unchanged for compatibility.

## Event Contract (SSE)

- Each event payload is a serialized `ChatStreamEvent`.
- Required top-level fields:
  - `type`
  - `runId`
  - `sessionId`
  - `at`
- Optional `data` contains event-specific payload.

## Tool Calling Baseline

- Server-side tool registry is allowlist-based.
- First shipped tool: `runReadOnlySql`.
- Tool input validation uses schema checks and read-only SQL guard.
- Tool failures are surfaced as `tool-error` events and persisted into trace summary.

## Rollout and Fallback

- Preferred client path: SSE endpoint.
- Compatibility fallback: legacy non-streaming endpoint.
- Rollback trigger suggestions:
  - sustained stream failure ratio above agreed threshold
  - sustained tool execution failure ratio above agreed threshold
  - severe regression in run persistence consistency

## Monitoring Checklist

- `GET /health` confirms:
  - `dependencies.llm.streamingEnabled === true`
  - `dependencies.llm.toolCallingEnabled === true`
  - stream endpoint and tool registry metadata are present
- Compare stream endpoint success rate against legacy endpoint baseline.
- Verify trace persistence includes tool events when tools are called.
