/**
 * One-off capture of the SMS opt-in workflow screenshot required by the
 * US_TOLL_FREE_REGISTRATION `optInImage` field.
 *
 * Reads credentials from frontend/.env the same way the e2e suite does, so the password is never
 * passed on the command line or echoed. Types a phone number into the field WITHOUT saving, so the
 * live profile record is not modified — the goal is a picture of the form as a member sees it, with
 * the consent box unchecked, which is precisely what a carrier reviewer wants to see.
 *
 * Run: node e2e/capture-optin.mjs
 */
import { chromium } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv();

const baseURL = process.env.E2E_BASE_URL ?? "https://jacksplaceattheridge.com";
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
if (!email || !password) throw new Error("Missing E2E_EMAIL / E2E_PASSWORD in frontend/.env");

// This app's <label>s are not associated to their inputs (no for/id), so getByLabel cannot be
// used — scope to the .field wrapper by its text, then take the control inside. Same reason
// e2e/forms.ts exists.
const field = (page, label) => page.locator(".field").filter({ hasText: label }).locator("input").first();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1000 }, deviceScaleFactor: 2 });

await page.goto(baseURL);
await field(page, "Email").fill(email);
await field(page, "Password").fill(password);
await page.getByRole("button", { name: "Sign in" }).click();
await page.getByRole("heading", { name: "Dashboard", level: 1 }).waitFor();

await page.goto(`${baseURL}/profile`);
await page.getByRole("heading", { name: /Your profile/, level: 1 }).waitFor();

// Un-greys the consent checkbox. Deliberately NOT saved.
await field(page, "Phone for SMS reminders").fill("+15551234567");

const card = page.locator(".card").first();
await card.screenshot({ path: "e2e/optin-workflow.png" });
console.log("wrote frontend/e2e/optin-workflow.png");

await browser.close();
