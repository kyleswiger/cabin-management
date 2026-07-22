import { test, expect } from "@playwright/test";
import { field } from "./forms";

// Operates only on the test account's own profile.
test("save a valid phone, reject an invalid one, then clear it", async ({ page }) => {
  await page.goto("/profile");
  await expect(page.getByRole("heading", { level: 1, name: /Your profile/ })).toBeVisible();
  await expect(field(page, "Email")).toBeDisabled();

  const phone = field(page, /Phone for SMS reminders/);

  // --- Valid E.164 saves ---
  await phone.fill("+15551234567");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".notice", { hasText: "Saved." })).toBeVisible();

  // --- Invalid format is rejected by the API ---
  await phone.fill("not-a-phone");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".error")).toBeVisible();

  // --- Restore to empty so the account leaves no stray number ---
  await phone.fill("");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".notice", { hasText: "Saved." })).toBeVisible();
});
