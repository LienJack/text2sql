# LLM Stream & Tool Calling Migration Spec

## Scope

- Backend LLM gateway migrates to Vercel AI SDK core (`ai` + `@ai-sdk/openai-compatible`).
- Chat primary request path supports SSE streaming endpoint.
- Tool Calling baseline is enabled with allowlisted server-side tools.

## API Changes

### Message Endpoints

- `POST /api/v1/sessions/:sessionId/messages`
- `POST /api/v1/sessions/:sessionId/messages/stream`

### Synchronous Contract (`/messages`)

- Response body is `AgentRunResponse`:
  - `kind: "agent-run"`
  - `outcome: "clarification" | "executionResult" | "rejected" | "failed"`
  - `run: SqlRun`
  - `agent: { provider, model, hasSql, hasToolCalls, hasError }`

### Stream Contract (`/messages/stream`)

- Response content type: `text/event-stream`
- Event types:
  - `start`
  - `text-delta`
  - `tool-call`
  - `tool-result`
  - `tool-error`
  - `state`
  - `finish`
  - `error`
- Each event payload is a serialized `ChatStreamEvent`.
- Required fields for every event:
  - `type`
  - `runId`
  - `sessionId`
  - `at`
  - `data`
- `data` is always a structured object, not raw string.

## Tool Calling Baseline

- Server-side tool registry is allowlist-based.
- First shipped tool: `runReadOnlySql`.
- Tool input validation uses schema checks and read-only SQL guard.
- Tool failures are surfaced as `tool-error` events and persisted into trace summary.

## Rollout and Fallback

- Preferred client path: SSE endpoint.
- Synchronous endpoint and stream endpoint share the same Agent-first semantic model.
- Rollback trigger suggestions:
  - sustained stream failure ratio above agreed threshold
  - sustained tool execution failure ratio above agreed threshold
  - severe regression in run persistence consistency

## Monitoring Checklist

- `GET /health` confirms:
  - `dependencies.llm.streamingEnabled === true`
  - `dependencies.llm.toolCallingEnabled === true`
  - stream endpoint and tool registry metadata are present
- 同步/流式的错误分类在相同故障输入下保持一致。
- Compare stream endpoint success rate against legacy endpoint baseline.
- Verify trace persistence includes tool events when tools are called.
