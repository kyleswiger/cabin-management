import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { MARKER } from "./env";
import { field } from "./forms";
import { deleteAlbumByTitle } from "./api";

/**
 * Print queue — PRD 5.9. A photo is flagged "print this" from the gallery lightbox,
 * shows up on the Prints page with who asked for it, can be withdrawn, and once the
 * printer-owner marks it printed it moves to the printed history (which is the record
 * of what's already in the physical album).
 *
 * Needs a real processed photo, so the spec uploads one into its own marked album and
 * deletes the album afterwards — the cascade takes the photo and its print state with it.
 */

const JPEG = fileURLToPath(new URL("./fixtures/e2e-photo.jpg", import.meta.url));
const PROCESSING_TIMEOUT = 120_000;

let albumTitle = "";

test.afterEach(async () => {
  if (albumTitle) await deleteAlbumByTitle(albumTitle);
  albumTitle = "";
});

test("flag a photo for print, withdraw it, then mark it printed", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  albumTitle = `${MARKER} print album ${Date.now()}`;
  const caption = `${MARKER} print me ${Date.now()}`;

  // --- Arrange: an album with one ready photo, captioned so it's identifiable on /prints ---
  await page.goto("/gallery");
  await page.getByRole("button", { name: "+ New album" }).click();
  await field(page, "Title").fill(albumTitle);
  await page.getByRole("button", { name: "Create album" }).click();
  await page.locator(".album-card", { hasText: albumTitle }).click();
  await page.locator('input[type="file"]').setInputFiles(JPEG);
  await expect(page.locator(".media-tile img.media-thumb")).toHaveCount(1, { timeout: PROCESSING_TIMEOUT });

  await page.locator(".media-tile").first().click();
  const lightbox = page.locator(".lightbox");
  await field(lightbox, "Caption").fill(caption);
  await lightbox.getByRole("button", { name: "Save" }).click();
  await expect(lightbox.getByRole("button", { name: "Save" })).toHaveCount(0);

  // --- Flag it (any member can, PRD 5.9) ---
  await lightbox.getByRole("button", { name: "🖨️ Print this" }).click();
  await expect(lightbox.getByText(/print requested/)).toBeVisible();
  await lightbox.getByRole("button", { name: "Close" }).click();
  // The album grid badges the flagged tile.
  await expect(page.locator(".media-tile", { hasText: "print requested" })).toHaveCount(1);

  // --- It lands in the queue with the requester's name ---
  await page.goto("/prints");
  await expect(page.getByRole("heading", { level: 1, name: "Print queue" })).toBeVisible();
  const queued = page.locator(".item-row", { hasText: caption });
  await expect(page.getByRole("heading", { name: "Waiting to be printed (1)" })).toBeVisible();
  await expect(queued).toContainText("Asked for by");

  // --- Withdraw the request from the queue page ---
  await queued.getByRole("button", { name: "Remove" }).click();
  await expect(page.locator(".item-row", { hasText: caption })).toHaveCount(0);
  await expect(page.getByText(/the physical .* album is all caught up/i)).toBeVisible();

  // --- Flag it again and mark it printed (admin-only) ---
  await page.goto("/gallery");
  await page.locator(".album-card", { hasText: albumTitle }).click();
  await page.locator(".media-tile").first().click();
  await page.locator(".lightbox").getByRole("button", { name: "🖨️ Print this" }).click();
  await expect(page.locator(".lightbox").getByText(/print requested/)).toBeVisible();

  await page.goto("/prints");
  await page.locator(".item-row", { hasText: caption }).getByRole("button", { name: "Mark printed" }).click();

  // Moved out of the pending queue and into the printed history, dated automatically.
  await expect(page.getByRole("heading", { name: "Waiting to be printed (0)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Already printed (1)" })).toBeVisible();
  await expect(page.locator(".item-row", { hasText: caption }).locator(".chip.done")).toContainText("printed");

  // A printed photo can't be re-queued — the history is what stops duplicate prints.
  await page.goto("/gallery");
  await page.locator(".album-card", { hasText: albumTitle }).click();
  await page.locator(".media-tile").first().click();
  await expect(page.locator(".lightbox").getByText(/🖨️ printed/)).toBeVisible();
  await expect(page.locator(".lightbox").getByRole("button", { name: "🖨️ Print this" })).toHaveCount(0);
});
