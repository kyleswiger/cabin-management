import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// Load e2e credentials from frontend/.env (gitignored). See .env.example.
loadEnv();

const baseURL = process.env.E2E_BASE_URL ?? "https://jacksplaceattheridge.com";

export default defineConfig({
  testDir: "./e2e",
  // These specs mutate shared, live data, so never run them in parallel against
  // one deployment — a reservation created by one worker could collide with another.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  globalTeardown: "./e2e/global-teardown.ts",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "e2e",
      testIgnore: /auth\.setup\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/state.json",
      },
    },
  ],
});
