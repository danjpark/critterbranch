import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Sim-driving tests run thousands of ticks; the 5s default is too tight for those.
    testTimeout: 60000,
  },
});
