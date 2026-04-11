/**
 * Keep test runs fully offline for tracing SDKs to avoid async network retries
 * that can outlive Jest and cause "Cannot log after tests are done" failures.
 */
process.env.LANGSMITH_TRACING = "false";
process.env.LANGSMITH_API_KEY = "";
process.env.LANGCHAIN_TRACING_V2 = "false";
process.env.LANGCHAIN_API_KEY = "";
process.env.LANGCHAIN_CALLBACKS_BACKGROUND = "false";
