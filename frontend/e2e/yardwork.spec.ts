import { test, expect } from "@playwright/test";
import { MARKER } from "./env";
import { field } from "./forms";

// Logs a chore of type "other" — unlike "mow"/"trim" it doesn't touch the reminder clock,
// so this leaves the real yardwork schedule undisturbed. The row is swept in globalTeardown
// via DELETE /chores/:id (see sweepTestData); against a deployment that predates that endpoint
// the marked row persists and the teardown says so.
test("log a yardwork entry and see it in history", async ({ page }) => {
  const note = `${MARKER} tidied shed ${Date.now()}`;

  await page.goto("/yardwork");
  await expect(page.getByRole("heading", { level: 1, name: /Yardwork log/ })).toBeVisible();

  await field(page, "What").selectOption("other");
  await field(page, "Note (optional)").fill(note);
  await page.getByRole("button", { name: "Log yardwork" }).click();

  const historyRow = page.locator(".item-row", { hasText: note });
  await expect(historyRow).toBeVisible();
  await expect(historyRow).toContainText("other");
});
