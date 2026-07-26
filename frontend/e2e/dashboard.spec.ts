import { test, expect } from "@playwright/test";

test("dashboard renders its summary cards", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();

  for (const title of ["Right now", "Next visit", "Yard", "Supplies to grab"]) {
    await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
  }
  await expect(page.getByRole("heading", { level: 2, name: /Open projects/ })).toBeVisible();

  // Deep-links into the sections work.
  await page.getByRole("link", { name: /Open calendar/ }).click();
  await expect(page).toHaveURL(/\/calendar$/);
});
