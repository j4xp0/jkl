// vitest configuration for this next.js project
// keeps the setup minimal: current tests cover pure typescript modules
// (validation, server logic), so the node environment is enough – jsdom and
// react plugins get added only when component tests arrive

import { defineConfig } from "vitest/config";

export default defineConfig({
  // resolves the "@/*" import alias from tsconfig.json inside tests
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
  },
});
