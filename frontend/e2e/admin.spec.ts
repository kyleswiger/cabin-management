import { test, expect } from "@playwright/test";
import { env } from "./env";

// Admin-only, deliberately NON-destructive: it never invites/removes users, changes roles,
// or moves the first-look radio. The settings save re-submits the existing values unchanged.
test("admin page renders and settings round-trip saves", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { level: 1, name: "Admin" })).toBeVisible();

  // Members table lists the test account.
  const membersCard = page.locator(".card", { hasText: "Family members" });
  await expect(membersCard).toBeVisible();
  await expect(membersCard.getByText(env.email)).toBeVisible();

  // Invite form is present.
  await expect(page.getByRole("heading", { level: 2, name: "Invite a family member" })).toBeVisible();

  // Rules & reminders: save the current values unchanged (exercises PUT /settings safely).
  const rulesCard = page.locator(".card", { hasText: "Rules & reminders" });
  await expect(rulesCard).toBeVisible();
  await rulesCard.getByRole("button", { name: "Save settings" }).click();
  await expect(page.locator(".notice", { hasText: "Settings saved." })).toBeVisible();

  // Notification log loads on demand.
  await page.getByRole("button", { name: "Show recent notification log" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Recent notifications" })).toBeVisible();
});
