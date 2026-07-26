import { test, expect } from "@playwright/test";
import { MARKER } from "./env";
import { field } from "./forms";

test("add a project, advance status, chip in, then delete", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  const title = `${MARKER} fix the dock ${Date.now()}`;

  await page.goto("/projects");
  await expect(page.getByRole("heading", { level: 1, name: /Maintenance & projects/ })).toBeVisible();

  // --- Add ---
  await page.getByRole("button", { name: "+ Add project" }).click();
  const addForm = page.locator(".card", { hasText: "New project" });
  await field(addForm, "Title").fill(title);
  await field(addForm, "Description").fill("e2e generated");
  await field(addForm, "Priority").selectOption("high");
  await field(addForm, "Estimated cost").fill("100");
  await addForm.getByRole("button", { name: "Add to backlog" }).click();

  const card = page.locator(".card", { hasText: title });
  await expect(card).toBeVisible();
  await expect(card.locator(".chip", { hasText: "high" })).toBeVisible();

  // --- Advance status ---
  await card.getByRole("combobox").selectOption("in_progress");
  await expect(card.getByRole("combobox")).toHaveValue("in_progress");

  // --- Chip in a contribution ---
  await card.getByRole("button", { name: /Ledger .* chip in/ }).click();
  await card.getByPlaceholder("$").fill("25");
  await card.getByPlaceholder("note (optional)").fill("e2e chip");
  await card.getByRole("button", { name: "Chip in" }).click();
  await expect(card).toContainText("$25 chipped in");
  await expect(card.locator(".item-row", { hasText: "e2e chip" })).toBeVisible();

  // --- Delete (admin only) ---
  await card.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(".card", { hasText: title })).toHaveCount(0);
});
