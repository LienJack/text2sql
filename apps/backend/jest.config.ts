import type { Config } from "jest";

const config: Config = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testRegex: ".*\\.spec\\.ts$",
  setupFiles: ["<rootDir>/test/jest.setup.ts"],
  transform: {
    "^.+\\.(t|j)s$": "ts-jest"
  },
  collectCoverageFrom: ["src/**/*.ts"],
  coverageDirectory: "coverage",
  testEnvironment: "node",
  moduleNameMapper: {
    "^@text2sql/chat-stream-protocol$":
      "<rootDir>/../../packages/chat-stream-protocol/src",
    "^@text2sql/chat-stream-protocol/(.*)$":
      "<rootDir>/../../packages/chat-stream-protocol/src/$1",
    "^@text2sql/shared-types$": "<rootDir>/../../packages/shared-types/src"
  }
};

export default config;
