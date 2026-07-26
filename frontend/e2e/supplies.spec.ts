import { test, expect } from "@playwright/test";
import { MARKER } from "./env";

test("add a supply, flag it low, see it in the grab banner, then remove it", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  const name = `${MARKER} bug spray ${Date.now()}`;

  await page.goto("/supplies");
  await expect(page.getByRole("heading", { level: 1, name: /Supply checklist/ })).toBeVisible();

  // --- Add ---
  await page.getByPlaceholder("Add an item (e.g. bug spray)").fill(name);
  await page.getByRole("button", { name: "Add item" }).click();
  const row = page.locator(".item-row", { hasText: name });
  await expect(row).toBeVisible();

  // --- Flag low -> appears in the "grab on the way up" banner ---
  await row.getByRole("button", { name: "low", exact: true }).click();
  await expect(page.locator(".notice", { hasText: "Grab on the way up" })).toContainText(name);

  // --- Back to ok -> leaves the banner ---
  await row.getByRole("button", { name: "ok", exact: true }).click();
  await expect(page.locator(".notice", { hasText: name })).toHaveCount(0);

  // --- Remove ---
  await row.getByRole("button", { name: "✕" }).click();
  await expect(page.locator(".item-row", { hasText: name })).toHaveCount(0);
});
