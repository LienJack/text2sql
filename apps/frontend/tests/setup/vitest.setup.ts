import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import React from "react";
import { afterEach } from "vitest";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
afterEach(() => {
  cleanup();
});
