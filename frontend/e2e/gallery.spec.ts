import { test, expect, type Locator, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { MARKER } from "./env";
import { field } from "./forms";
import { deleteAlbumByTitle } from "./api";

/**
 * Photo gallery — PRD 5.8. Covers the whole media pipeline against the live deployment:
 * album create/rename/delete, presigned upload of untouched originals, derivative
 * generation by the media Lambda (JPEG *and* HEIC — the HEIC path is the reason the
 * custom libvips+libheif layer exists), signed-cookie delivery through the /media/*
 * CloudFront behavior, caption metadata, and delete integrity.
 *
 * Everything here mutates live data, so the album title carries MARKER and the spec
 * removes the album in `afterEach` — the cascade takes the uploaded media with it.
 */

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const JPEG = fixture("e2e-photo.jpg");
// A real HEVC-coded HEIC (libheif's own sample), not an AVIF-in-HEIF lookalike: the
// Lambda layer builds libheif with libde265 and WITH_AOM_DECODER=OFF, so an AV1-coded
// .heic would fail to decode for reasons that have nothing to do with the app.
const HEIC = fixture("e2e-photo-c003.heic");
// The HEIC fixture is deliberately not committed — the only readily available
// conformance samples carry no usable license, so this expects a real iPhone photo
// dropped in locally (see e2e/fixtures/README.md). Absent it, the upload leg runs
// JPEG-only rather than failing, and CI simply doesn't exercise the libheif path.
const HAS_HEIC = existsSync(HEIC);
const UPLOADS = HAS_HEIC ? [JPEG, HEIC] : [JPEG];

/** Derivatives are written by an S3-triggered Lambda and the page polls every 10s. */
const PROCESSING_TIMEOUT = 120_000;

let albumTitle = "";

test.afterEach(async () => {
  if (albumTitle) await deleteAlbumByTitle(albumTitle);
  albumTitle = "";
});

/** Create a trip album through the UI and open it. Returns nothing — the caller is on the album page. */
async function createAlbum(page: Page, title: string): Promise<void> {
  await page.goto("/gallery");
  await expect(page.getByRole("heading", { level: 1, name: "Photo gallery" })).toBeVisible();
  await page.getByRole("button", { name: "+ New album" }).click();
  await field(page, "Title").fill(title);
  await page.getByRole("button", { name: "Create album" }).click();
  await expect(page.locator(".album-card", { hasText: title })).toBeVisible();
}

/** An <img> that rendered proves the bytes came back through the signed-cookie behavior. */
async function expectImageLoaded(img: Locator): Promise<void> {
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 30_000 })
    .toBeGreaterThan(0);
}

test("album lifecycle: create, upload a JPEG and a HEIC, caption, delete an item", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  albumTitle = `${MARKER} trip album ${Date.now()}`;

  await createAlbum(page, albumTitle);
  await page.locator(".album-card", { hasText: albumTitle }).click();
  await expect(page.getByRole("heading", { level: 1, name: albumTitle })).toBeVisible();
  await expect(page.getByText(/Nothing here yet/)).toBeVisible();

  // --- Upload the untouched originals via the presigned PUT (PRD 5.8) ---
  // The input is display:none behind a styled button; setInputFiles drives it directly.
  await page.locator('input[type="file"]').setInputFiles(UPLOADS);

  // --- The media Lambda writes web + thumb derivatives; the page polls until ready ---
  // Two loaded <img> tiles is the assertion that matters: a HEIC the layer couldn't
  // decode would land as a "Processing failed" placeholder instead, and a thumbnail
  // that renders at all has come back through /media/* with valid signed cookies.
  const tiles = page.locator(".media-tile");
  await expect(tiles).toHaveCount(UPLOADS.length, { timeout: PROCESSING_TIMEOUT });
  await expect(page.locator(".media-tile.placeholder")).toHaveCount(0, { timeout: PROCESSING_TIMEOUT });
  const thumbs = page.locator(".media-tile img.media-thumb");
  await expect(thumbs).toHaveCount(UPLOADS.length);
  await expectImageLoaded(thumbs.first());
  await expectImageLoaded(thumbs.last());

  // --- Lightbox: full-size web derivative + caption metadata ---
  await tiles.first().click();
  const lightbox = page.locator(".lightbox");
  await expect(lightbox).toBeVisible();
  await expectImageLoaded(lightbox.locator(".lightbox-media img"));

  const caption = `${MARKER} caption ${Date.now()}`;
  await field(lightbox, "Caption").fill(caption);
  await lightbox.getByRole("button", { name: "Save" }).click();
  await expect(lightbox.getByRole("button", { name: "Save" })).toHaveCount(0);

  // Survives a reload — the caption is on the row, not just in React state.
  await page.reload();
  await page.locator(".media-tile").first().click();
  await expect(field(page.locator(".lightbox"), "Caption")).toHaveValue(caption);

  // --- Delete one item; the other is untouched ---
  await page.locator(".lightbox").getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(".lightbox")).toHaveCount(0);
  await expect(page.locator(".media-tile")).toHaveCount(1);

  // Back on the album list the count reflects the delete.
  await page.goto("/gallery");
  await expect(page.locator(".album-card", { hasText: albumTitle })).toContainText("1 item");
});

test("rename an album and delete it, cascading its media", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  const originalTitle = `${MARKER} rename me ${Date.now()}`;
  albumTitle = originalTitle;

  await createAlbum(page, originalTitle);
  await page.locator(".album-card", { hasText: originalTitle }).click();

  // PUT/DELETE /albums/:id shipped without any UI; the buttons that reach them are
  // newer than some deployed stacks. Skip rather than fail against an older deployment.
  const renameButton = page.getByRole("button", { name: "Rename" });
  await expect(page.getByRole("heading", { level: 1, name: originalTitle })).toBeVisible();
  test.skip(
    (await renameButton.count()) === 0,
    "Deployment predates the album Rename/Delete buttons in Gallery.tsx.",
  );

  // Give it a photo first, so the delete below is a real cascade and not an empty-album delete.
  await page.locator('input[type="file"]').setInputFiles(JPEG);
  await expect(page.locator(".media-tile img.media-thumb")).toHaveCount(1, { timeout: PROCESSING_TIMEOUT });

  // --- Rename ---
  const renamed = `${MARKER} renamed ${Date.now()}`;
  await renameButton.click();
  await field(page, "Album title").fill(renamed);
  await page.getByRole("button", { name: "Save title" }).click();
  await expect(page.getByRole("heading", { level: 1, name: renamed })).toBeVisible();
  albumTitle = renamed; // so afterEach cleans up the right one if anything below fails

  // The new title is what the gallery list shows — the old one is gone entirely.
  await page.goto("/gallery");
  await expect(page.locator(".album-card", { hasText: renamed })).toBeVisible();
  await expect(page.locator(".album-card", { hasText: originalTitle })).toHaveCount(0);

  // --- Delete (admin-only), cascading the photo with it ---
  await page.locator(".album-card", { hasText: renamed }).click();
  await page.getByRole("button", { name: "Delete album" }).click();
  await expect(page).toHaveURL(/\/gallery$/);
  await expect(page.locator(".album-card", { hasText: renamed })).toHaveCount(0);

  // Cascade integrity: the album's photo must not survive as an orphan in the print
  // queue, which is the one page that lists media by GSI rather than by album.
  await page.goto("/prints");
  await expect(page.getByRole("heading", { level: 1, name: "Print queue" })).toBeVisible();
  await expect(page.locator(".item-row", { hasText: MARKER })).toHaveCount(0);

  albumTitle = ""; // deleted through the UI; nothing for afterEach to do
});
