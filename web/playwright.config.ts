import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  reporter: [
    ["list"],
    ["json", { outputFile: "../docs/frontend/browser-results.json" }],
  ],
  use: { baseURL: "http://127.0.0.1:4173/ipfs/noop/", headless: true },
  webServer: {
    command: "node tests/serve.mjs",
    url: "http://127.0.0.1:4173/ipfs/noop/",
    reuseExistingServer: false,
  },
});
