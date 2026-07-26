import { test as setup, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { env } from "./env";
import { field } from "./forms";

const STATE_PATH = "e2e/.auth/state.json";

// Sign in once through the real Cognito login form, then persist the browser storage
// (the amazon-cognito-identity-js session lives in localStorage) so every other spec
// starts already authenticated instead of re-driving the form.
setup("authenticate", async ({ page }) => {
  mkdirSync("e2e/.auth", { recursive: true });

  await page.goto("/");
  await field(page, "Email").fill(env.email);
  await field(page, "Password").fill(env.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Landing on the Dashboard (nav + heading) means the session is established.
  await expect(page.getByRole("navigation")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();

  await page.context().storageState({ path: STATE_PATH });
});
