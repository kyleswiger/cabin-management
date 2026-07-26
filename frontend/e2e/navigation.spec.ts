import { test, expect } from "@playwright/test";

// The test account is an admin, so every nav item (including Admin) should be present.
const PAGES: Array<{ link: string; heading: RegExp }> = [
  { link: "Calendar", heading: /Reservation calendar/i },
  { link: "Supplies", heading: /Supply checklist/i },
  { link: "Projects", heading: /Maintenance & projects/i },
  { link: "Yardwork", heading: /Yardwork log/i },
  { link: "Admin", heading: /^Admin$/i },
  { link: "Dashboard", heading: /Dashboard/i },
];

test("navigates across every page via the top nav", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation");
  await expect(nav).toBeVisible();

  for (const { link, heading } of PAGES) {
    await nav.getByRole("link", { name: link, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  }
});
