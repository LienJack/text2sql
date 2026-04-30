import type { Config } from "jest";

const config: Config = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testRegex: "src/.*\\.spec\\.ts$",
  transform: {
    "^.+\\.(t|j)s$": "ts-jest"
  },
  testEnvironment: "node",
  moduleNameMapper: {
    "^@text2sql/shared-types$": "<rootDir>/../shared-types/src"
  }
};

export default config;
