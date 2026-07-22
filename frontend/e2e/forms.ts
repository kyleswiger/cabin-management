import type { Locator, Page } from "@playwright/test";

/**
 * The app renders form rows as:
 *   <div class="field"><label>Some label</label><input|textarea|select/></div>
 * with the label NOT associated to the control (no for/id), so Playwright's getByLabel
 * can't resolve it. This locates the control inside the .field whose label text matches.
 */
export function field(scope: Page | Locator, label: string | RegExp): Locator {
  return scope.locator(".field", { hasText: label }).locator("input, textarea, select");
}
