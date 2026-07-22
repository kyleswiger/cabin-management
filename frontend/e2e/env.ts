import { config as loadEnv } from "dotenv";

loadEnv();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var ${name}. Copy frontend/.env.example to frontend/.env and fill it in ` +
        `(see the "End-to-end tests" section of the README).`
    );
  }
  return value;
}

function requiredEither(e2eName: string, viteName: string): string {
  const value = process.env[e2eName] ?? process.env[viteName];
  if (!value) {
    throw new Error(
      `Missing required env var ${e2eName} (or ${viteName}). Copy frontend/.env.example to frontend/.env ` +
        `and fill it in (see the "End-to-end tests" section of the README).`
    );
  }
  return value;
}

/** Shared configuration for the Playwright suite, sourced from frontend/.env. */
export const env = {
  baseURL: process.env.E2E_BASE_URL ?? "https://jacksplaceattheridge.com",
  email: required("E2E_EMAIL"),
  password: required("E2E_PASSWORD"),
  // Non-secret deployment identifiers (also baked into the public SPA). Used only by the
  // API cleanup sweeper, never by the UI assertions. Reuse the frontend build's VITE_* vars.
  apiUrl: requiredEither("E2E_API_URL", "VITE_API_URL"),
  userPoolId: requiredEither("E2E_USER_POOL_ID", "VITE_USER_POOL_ID"),
  clientId: requiredEither("E2E_CLIENT_ID", "VITE_CLIENT_ID"),
};

/** Marker prefixed onto every entity the suite creates, so leftovers are easy to find and sweep. */
export const MARKER = "[e2e]";
