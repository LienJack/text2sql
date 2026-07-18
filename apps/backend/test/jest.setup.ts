/**
 * Keep test runs fully offline for tracing SDKs to avoid async network retries
 * that can outlive Jest and cause "Cannot log after tests are done" failures.
 */
process.env.LANGSMITH_TRACING = "false";
process.env.LANGSMITH_API_KEY = "";
process.env.LANGCHAIN_TRACING_V2 = "false";
process.env.LANGCHAIN_API_KEY = "";
process.env.LANGCHAIN_CALLBACKS_BACKGROUND = "false";

/**
 * AppModule integration tests explicitly exercise the services in scope. Avoid
 * starting the unrelated analysis outbox poller, especially in legacy fixtures
 * that intentionally disable PostgreSQL. Analysis runtime tests call
 * dispatchPending() themselves.
 */
process.env.ANALYSIS_TEST_DISABLE_BACKGROUND_DISPATCH = "true";
