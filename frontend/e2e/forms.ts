import type { Locator, Page } from "@playwright/test";

/**
 * The app renders labelled form rows as:
 *   <div class="field"><label>Some label</label><input|textarea|select/></div>
 * with the label NOT associated to the control (no for/id), so Playwright's getByLabel
 * can't resolve it. This locates the control inside the .field whose label text matches.
 *
 * Checkbox rows use a different shape — the control is nested *inside* the <label>:
 *   <div class="field"><label><input type="checkbox"/> Long consent sentence…</label></div>
 * Those sentences repeat short label words ("Email me reminders…" vs the "Email" row), which
 * made this helper resolve to two controls and fail strict mode. Restricting to direct
 * children of .field matches only the labelled-row shape and skips checkbox rows.
 */
export function field(scope: Page | Locator, label: string | RegExp): Locator {
  return scope.locator(".field", { hasText: label }).locator("> input, > textarea, > select");
}
