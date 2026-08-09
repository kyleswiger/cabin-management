import { test, expect } from "@playwright/test";
import { MARKER } from "./env";
import { field } from "./forms";

/**
 * Local treks & area guide — PRD 5.11. A living, member-curated directory: anyone can
 * add or edit, delete is creator-or-admin. Entries render grouped by category, so an
 * edit that changes the category has to move the entry between sections.
 */

test("add a spot, edit it into another category, then remove it", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  const name = `${MARKER} falls loop ${Date.now()}`;
  const renamed = `${MARKER} the diner ${Date.now()}`;

  await page.goto("/treks");
  await expect(page.getByRole("heading", { level: 1, name: "Area guide" })).toBeVisible();

  // --- Add, with both optional fields filled ---
  await page.getByRole("button", { name: "+ Add a spot" }).click();
  const addForm = page.locator(".card", { hasText: "New entry" });
  await field(addForm, "Name").fill(name);
  await field(addForm, "Category").selectOption("hike");
  await field(addForm, "Description").fill("Two miles, mostly flat, waterfall at the turnaround.");
  await field(addForm, "Drive time").fill("25");
  await field(addForm, "Link").fill("https://example.com/falls-loop");
  await page.getByRole("button", { name: "Add to guide" }).click();

  const hikes = page.locator(".card", { hasText: "Hike & paddle" });
  const row = hikes.locator(".item-row", { hasText: name });
  await expect(row).toBeVisible();
  await expect(row).toContainText("~25 min");
  await expect(row).toContainText("Two miles, mostly flat");
  await expect(row.getByRole("link", { name: /map \/ info/ })).toHaveAttribute(
    "href",
    "https://example.com/falls-loop",
  );

  // --- Edit: rename, recategorise, and clear both optional fields ---
  await row.getByRole("button", { name: "Edit" }).click();
  const editForm = page.locator("form", { hasText: "Save" }).filter({ has: page.locator('input[type="url"]') });
  await field(editForm, "Name").fill(renamed);
  await field(editForm, "Category").selectOption("food");
  await field(editForm, "Description").fill("Pie counter, cash only, closes at 2.");
  await field(editForm, "Drive time").fill("");
  await field(editForm, "Link").fill("");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  // Moved out of hikes and into food & drink, with the optional fields gone.
  await expect(page.locator(".card", { hasText: "Hike & paddle" }).locator(".item-row", { hasText: name })).toHaveCount(0);
  const moved = page.locator(".card", { hasText: "Food & drink" }).locator(".item-row", { hasText: renamed });
  await expect(moved).toBeVisible();
  await expect(moved).toContainText("Pie counter");
  await expect(moved).not.toContainText("min");
  await expect(moved.getByRole("link", { name: /map \/ info/ })).toHaveCount(0);

  // Survives a reload — it's persisted, not just local state.
  await page.reload();
  await expect(page.locator(".card", { hasText: "Food & drink" }).locator(".item-row", { hasText: renamed })).toBeVisible();

  // --- Remove (creator-or-admin) ---
  await page.locator(".item-row", { hasText: renamed }).getByRole("button", { name: "✕" }).click();
  await expect(page.locator(".item-row", { hasText: renamed })).toHaveCount(0);
  await expect(page.locator(".item-row", { hasText: MARKER })).toHaveCount(0);
});
