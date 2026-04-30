import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@text2sql/chat-stream-protocol": fileURLToPath(
        new URL("../../packages/chat-stream-protocol/dist/index.js", import.meta.url)
      ),
      "@text2sql/chat-stream-protocol/client": fileURLToPath(
        new URL("../../packages/chat-stream-protocol/dist/client.js", import.meta.url)
      )
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: ["tests/setup/vitest.setup.ts"],
    include: ["tests/**/*.spec.ts", "tests/**/*.spec.tsx"]
  }
});
