import { test, expect } from "@playwright/test";
import { MARKER } from "./env";
import { field } from "./forms";

// Logs a chore of type "other" — unlike "mow"/"trim" it doesn't touch the reminder clock,
// so this leaves the real yardwork schedule undisturbed. The spec removes its own row
// through the UI; sweepTestData's DELETE /chores/:id pass in globalTeardown is only the
// safety net for a run that dies mid-test.
test("log a yardwork entry, see it in history, then remove it", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  const note = `${MARKER} tidied shed ${Date.now()}`;

  await page.goto("/yardwork");
  await expect(page.getByRole("heading", { level: 1, name: /Yardwork log/ })).toBeVisible();

  await field(page, "What").selectOption("other");
  await field(page, "Note (optional)").fill(note);
  await page.getByRole("button", { name: "Log yardwork" }).click();

  const historyRow = page.locator(".item-row", { hasText: note });
  await expect(historyRow).toBeVisible();
  await expect(historyRow).toContainText("other");

  // The logger can take back a mis-logged chore (PRD 5.2 — a stray mow would otherwise
  // suppress the arrival-day reminder for good).
  await historyRow.getByRole("button", { name: "✕" }).click();
  await expect(historyRow).toHaveCount(0);
});
