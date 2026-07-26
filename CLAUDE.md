# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A private, invite-only web app for coordinating a shared property (family cabin): reservations,
supply checklist, maintenance projects with a contribution ledger, and occupancy-aware SMS
yardwork reminders. Fully serverless on AWS. `PRD.md` is the product spec and the source of the
business rules; code comments reference its section numbers (e.g. "PRD 5.2").

## Commands

```bash
# Backend (TypeScript Lambdas)
cd backend && npm run typecheck        # tsc --noEmit — the only backend check; there are no unit tests
cd backend && npm run build            # esbuild → dist/api.zip + dist/reminders.zip (Terraform reads these)

# Frontend
cd frontend && npm run dev             # Vite dev server on :5173 (allowed by the API's CORS config)
cd frontend && npm run build           # tsc -b && vite build
cd frontend && npm run lint            # oxlint

# Deploy everything (build → terraform apply → S3 sync → CloudFront invalidation)
./deploy.sh --profile my-profile [-auto-approve]
```

`npm run dev` reads branding from `profile.example/cabin.config.json` unless `CABIN_CONFIG`
points elsewhere.

### End-to-end tests

Playwright drives a real browser against a **deployed** instance — there is no local backend
to test against. Requires `frontend/.env` (copy `.env.example`) and a dedicated test account
created by `backend/scripts/create-test-user.mjs`.

```bash
cd frontend
npm run test:e2e                              # whole suite, headless
npx playwright test e2e/supplies.spec.ts      # one spec file
npx playwright test -g "add a supply"         # one test by title
npm run test:e2e:ui                           # interactive runner
npm run test:e2e:report                       # last HTML report
```

The suite is deliberately `workers: 1, fullyParallel: false` — it mutates shared live data.
Keep it that way. Every entity a spec creates must carry the `MARKER` (`[e2e]`) prefix from
`e2e/env.ts` and be deleted by the spec; `e2e/global-teardown.ts` sweeps leftovers via
`sweepTestData()` in `e2e/api.ts`.

## Architecture

**Frontend** (React 19 + Vite SPA on S3/CloudFront) → **API Gateway HTTP API** (JWT authorizer,
Cognito) → **one Lambda** (`backend/src/api/handler.ts`) → **one DynamoDB table**.
A second Lambda (`backend/src/reminders/handler.ts`) runs daily on EventBridge Scheduler and
sends SMS via SNS. Terraform in `infra/` owns the entire stack; nothing is shared between
deployments.

### The profile directory is the only place deployment-specific values live

This repo contains no real domains, project names, or account values. `deploy.sh --profile DIR`
reads `DIR/cabin.config.json` (branding/copy), `DIR/terraform.tfvars`, optional `DIR/backend.hcl`
(S3 remote state; local state in the profile dir when absent), and optional `DIR/public/`
(static overlay). `profile*/` is gitignored except `profile.example/`.

`cabin.config.json` is consumed three ways and must stay in sync across them:
- Vite resolves the `app-config` module alias to it (`frontend/src/branding.ts`)
- Terraform `jsondecode`s it into `local.branding` (`infra/variables.tf`)
- Terraform passes a subset as Lambda env vars, read by `backend/src/lib/branding.ts`

So user-visible naming must never be hardcoded — use `branding.*` in the frontend and the
`APP_NAME` / `PROPERTY_NOUN` / `PRIORITY_USER_LABEL*` constants in the backend.

`deploy.sh` generates `infra/backend.tf` (gitignored) to switch between local and S3 state, and
refuses to run when a non-empty local state file exists alongside a `backend.hcl` — that would
orphan deployed resources.

### API routing

`backend/src/api/handler.ts` holds a hand-rolled route table: `[method, "/pattern/:id", handler]`,
matched against `event.rawPath` with the `/api` prefix stripped. Adding an endpoint means adding
a row there plus a function in `src/api/routes/`. Conventions enforced by the handler:
- Throw `ApiError(status, message)` from `lib/http.ts`; anything else becomes a 500.
- POST returns 201, everything else 200; a handler returning `undefined` yields `{ ok: true }`.
- API Gateway defines explicit GET/POST/PUT/DELETE routes, never `ANY` — an `ANY` route would
  swallow CORS preflight OPTIONS and 401 them at the JWT authorizer.

### Data model — single table, one GSI

Keys are `PK`/`SK` with `GSI1PK`/`GSI1SK` for listing:

| Entity | PK | SK | GSI1PK | GSI1SK |
| --- | --- | --- | --- | --- |
| Reservation | `RES#<id>` | `META` | `RESERVATION` | startDate |
| Supply | `SUPPLY#<id>` | `META` | `SUPPLY` | name (lowercased) |
| Project | `PROJECT#<id>` | `META` | `PROJECT` | createdAt |
| Contribution | `PROJECT#<id>` | `CONTRIB#<id>` | `CONTRIB` | date |
| Chore log | `CHORE#<id>` | `META` | `CHORE` | completedDate |
| User profile | `USER#<sub>` | `PROFILE` | `USER` | name (lowercased) |
| Notification | `NOTIF#<id>` | `META` | `NOTIF` | ISO timestamp |
| Settings | `SETTINGS` | `META` | — | — |

Listing is `queryType("RESERVATION")` etc. from `lib/db.ts` (paginates GSI1). Data volume is
tiny by design — routes routinely fetch a whole entity type and filter in memory. Reservations
are soft-deleted (`status: "cancelled"`), so every read path must filter on `status === "active"`.
Settings are read through `getSettings()`, which merges over `DEFAULT_SETTINGS`; new settings
keys need a default there, not a migration.

### Auth and authorization

Cognito user pool, invite-only, no public signup. The JWT authorizer verifies the token; the
Lambda derives `Caller` (`sub`, `email`, `name`, `isAdmin`) from `cognito:groups` claims in
`lib/http.ts`. **Authorization is per-route, in the route function** — there is no middleware.
Admin-only: settings, notification log, user invite/edit/remove, project delete. Creator-or-admin:
reservation edit/cancel. `ensureProfile()` lazily creates a DynamoDB profile on first `GET /me`,
so the profile row and the Cognito user can drift; `role` lives in both places (group + profile)
and both must be updated together.

Frontend session handling is in `src/auth.ts` (amazon-cognito-identity-js, refresh-token aware);
`src/api.ts` attaches the ID token and throws `ApiRequestError`. `App.tsx` gates the whole app on
`GET /me` and exposes `useAuth()`.

### Business rules worth knowing before touching dates

- **Overlap** is half-open: `start < other.end && other.start < end`. Same-day turnover is legal.
- **First look**: when `priorityUserId` is set, non-priority users cannot book more than
  `priorityWindowDays` (default 45) ahead of arrival.
- **Reminders** (`reminders/handler.ts`) fire on exact day matches against `todayISO()`:
  pre-visit (arrival − `preVisitReminderDays`, includes low/out supplies), checkout-day mow when
  the gap to the next visit exceeds `vacancyThresholdDays`, and an arrival-day backstop when the
  last `mow` chore is older than that threshold. Editing/cancelling a reservation also triggers
  an ad-hoc vacancy SMS.
- `sendSms()` never throws — it logs a `NOTIF` row with status `sent`/`skipped_no_phone`/`failed:…`
  so SES/SNS sandbox failures surface in Admin → notification log instead of breaking the API.
- Dates are `YYYY-MM-DD` strings compared lexicographically throughout; validate with
  `assertDate()` and avoid introducing `Date` arithmetic that could shift across time zones.

## Operator scripts

Run from the repo root with `TABLE_NAME` / `USER_POOL_ID` from `terraform output`:
`backend/scripts/seed.mjs` (idempotent backlog + supplies), `create-user.mjs` (first admin,
emails a temp password), `create-test-user.mjs` (permanent-password e2e account),
`migrate-priority-settings.mjs` (one-time rename of the old `mom*` settings keys).
