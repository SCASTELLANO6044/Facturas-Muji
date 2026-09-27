import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  outputDir: ".test-artifacts/results",
  fullyParallel: true,
  use: {
    baseURL: "http://127.0.0.1:3000",
    headless: true,
    channel: "msedge",
    viewport: { width: 1240, height: 1000 },
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
  },
});
