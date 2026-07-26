import { test, expect } from "@playwright/test";
import { field } from "./forms";

// These run signed OUT — override the shared authenticated storage state.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("login page", () => {
  test("rejects a wrong password", async ({ page }) => {
    await page.goto("/");
    await field(page, "Email").fill("nobody@example.com");
    await field(page, "Password").fill("definitely-wrong-123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator(".error")).toBeVisible();
    // Still on the login screen, not the app.
    await expect(page.getByRole("navigation")).toHaveCount(0);
  });

  test("forgot-password flow toggles the reset form", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Forgot password?" }).click();
    await expect(page.getByRole("button", { name: "Email me a reset code" })).toBeVisible();
    await page.getByRole("button", { name: "Back to sign in" }).click();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });
});
