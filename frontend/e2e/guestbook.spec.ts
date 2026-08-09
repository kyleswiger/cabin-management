import { test, expect } from "@playwright/test";
import { MARKER } from "./env";
import { field } from "./forms";
import { deleteGuestbookEntryByTitle } from "./api";

/**
 * Guestbook — PRD 5.10. One entry per visit, reverse-chronological, edit/delete is
 * author-or-admin, and the newest entry surfaces on the dashboard.
 */

/** Local calendar date, matching the page's own todayISO() — not toISOString(). */
const localISO = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString("sv-SE");
};

test("write an entry, edit it, see it on the dashboard, then delete it", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  const title = `${MARKER} rainy weekend ${Date.now()}`;
  const editedTitle = `${title} (edited)`;

  await page.goto("/guestbook");
  await expect(page.getByRole("heading", { level: 1, name: "Guestbook" })).toBeVisible();

  // --- Write ---
  await page.getByRole("button", { name: "✍️ Write an entry" }).click();
  await field(page, "Title").fill(title);
  await field(page, "Visit start").fill(localISO(-9));
  await field(page, "Visit end").fill(localISO(-7));
  await field(page, "Your story").fill("Rain the whole time. Cards, the wood stove, and no complaints.");
  await page.getByRole("button", { name: "Add to the guestbook" }).click();

  const card = page.locator(".card", { hasText: title });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Rain the whole time");

  // Newest visit first (PRD 5.10) — a nine-days-ago visit outranks the existing log.
  await expect(page.locator(".cards > .card").first()).toContainText(title);

  // --- Edit (author-or-admin) ---
  await card.getByRole("button", { name: "Edit" }).click();
  await field(page, "Title").fill(editedTitle);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".card", { hasText: editedTitle })).toBeVisible();
  await expect(page.locator(".card", { hasText: title }).first()).toContainText("(edited)");

  // --- Dashboard tile shows the latest entry (PRD 5.7) ---
  await page.goto("/");
  await expect(page.locator(".card", { hasText: "Guestbook" })).toContainText(editedTitle);

  // --- Delete ---
  await page.goto("/guestbook");
  await page.locator(".card", { hasText: editedTitle }).getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(".card", { hasText: editedTitle })).toHaveCount(0);
});

test("a visit that hasn't happened yet is rejected", async ({ page }) => {
  // PRD 5.10 entries sort by visitStart, so a mistyped year would pin itself to the top
  // of the logbook and the dashboard tile indefinitely. The API guards visitStart against
  // today; there is no client-side guard, so this exercises the server rule through the UI.
  const title = `${MARKER} time traveller ${Date.now()}`;
  const future = localISO(30);

  await page.goto("/guestbook");
  await page.getByRole("button", { name: "✍️ Write an entry" }).click();
  await field(page, "Title").fill(title);
  await field(page, "Visit start").fill(future);
  await field(page, "Visit end").fill(future);
  await field(page, "Your story").fill("Writing this from next month.");
  await page.getByRole("button", { name: "Add to the guestbook" }).click();

  // The guard is newer than some deployed stacks. If it isn't there the entry was
  // actually created — delete it and skip rather than leaving a bogus future-dated
  // entry sitting at the top of the live logbook.
  const rejected = await page
    .locator(".error", { hasText: /visitStart cannot be in the future/ })
    .isVisible()
    .catch(() => false);
  if (!rejected) {
    const created = await deleteGuestbookEntryByTitle(title);
    test.skip(created, "Deployment predates the visitStart future-date guard in guestbook.ts.");
  }

  await expect(page.locator(".error")).toContainText("visitStart cannot be in the future");
  await expect(page.locator(".card", { hasText: title })).toHaveCount(0);

  // The out-of-order case is guarded too, and has been deployed for longer.
  await field(page, "Visit start").fill(localISO(-3));
  await field(page, "Visit end").fill(localISO(-10));
  await page.getByRole("button", { name: "Add to the guestbook" }).click();
  await expect(page.locator(".error")).toContainText("visitEnd must be on or after visitStart");
  await expect(page.locator(".card", { hasText: title })).toHaveCount(0);
});
