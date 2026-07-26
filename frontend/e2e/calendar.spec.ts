import { test, expect } from "@playwright/test";
import { findOpenSlot } from "./api";
import { MARKER } from "./env";
import { field } from "./forms";

test("create, edit, and cancel a reservation", async ({ page }) => {
  // Auto-accept the window.confirm() the Cancel button raises.
  page.on("dialog", (d) => d.accept());

  const { startDate, endDate } = await findOpenSlot();
  const attendees = `${MARKER} booking ${Date.now()}`;

  await page.goto("/calendar");
  await expect(page.getByRole("heading", { level: 1, name: /Reservation calendar/ })).toBeVisible();

  // --- Create ---
  await page.getByRole("button", { name: "+ New reservation" }).click();
  const form = page.locator(".card", { hasText: "New reservation" });
  await field(form, "Arrival").fill(startDate);
  await field(form, "Departure").fill(endDate);
  await field(form, "Who's coming?").fill(attendees);
  await field(form, "Notes").fill("created by e2e");
  await form.getByRole("button", { name: "Reserve" }).click();

  const row = page.locator(".item-row", { hasText: attendees });
  await expect(row).toBeVisible();
  await expect(row).toContainText("created by e2e");

  // --- Edit (change the notes) ---
  await row.getByRole("button", { name: "Edit" }).click();
  const editForm = page.locator(".card", { hasText: "Edit reservation" });
  await field(editForm, "Notes").fill("edited by e2e");
  await editForm.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".item-row", { hasText: attendees })).toContainText("edited by e2e");

  // --- Cancel ---
  await page.locator(".item-row", { hasText: attendees }).getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".item-row", { hasText: attendees })).toHaveCount(0);
});
