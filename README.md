# Cabin Management

A private, invite-only web app for a shared property — a family cabin, a co-owned
lake house, a hunting camp. It handles the coordination problems that otherwise live
in a group text: who's using the place, what needs doing before and after a visit,
what supplies ran out, and who has chipped in on repairs.

Fully serverless on AWS. It scales to zero and costs a few dollars a month to run.

See [PRD.md](PRD.md) for the full product spec and the reasoning behind the rules.

## Features

- **Reservation calendar** with a configurable "first look" priority window, so one
  designated member can claim dates before they open to everyone.
- **Occupancy-aware yardwork reminders** — SMS that fires when the property is about
  to sit empty, or when someone is arriving to an overgrown yard.
- **Supply checklist** that folds low/out items into the pre-visit text.
- **Maintenance backlog** with a contribution ledger, so shared costs stay visible.
- **Invite-only auth** with an admin role. No public signup.

## Architecture

- **Frontend:** React/Vite SPA on S3 + CloudFront (private bucket, Origin Access Control)
- **API:** API Gateway (HTTP API) + one Node.js 22 Lambda, JWT-authorized by Cognito
- **Auth:** Cognito User Pool, invite-only; `admin` group for admin rights
- **Data:** Single DynamoDB table (on-demand), GSI1 for per-entity listing
- **Reminders:** EventBridge Scheduler → daily Lambda → SNS SMS
- **Email:** SES domain identity (DKIM + MAIL FROM + DMARC) when a custom domain is set

```
repo/
├── backend/          TypeScript Lambdas (src/api, src/reminders) + operator scripts
├── frontend/         Vite + React SPA
├── infra/            Terraform — the whole stack, nothing shared
├── profile.example/  A complete deployment profile you can copy
└── deploy.sh         One-command build + deploy
```

## Configuration

This repo contains no deployment-specific values. Everything that varies lives in a
**profile directory** you pass to `deploy.sh`:

| File | Purpose |
| --- | --- |
| `cabin.config.json` | Naming and message copy (required) |
| `terraform.tfvars` | Project name, region, custom domain (required) |
| `backend.hcl` | S3 remote state config (optional — local state if absent) |
| `terraform.tfstate` | Local state; used only when `backend.hcl` is absent |
| `public/` | Optional static files overlaid onto the built site (favicon, images) |

`cabin.config.json` is read by both the frontend build and Terraform, so naming has a
single source of truth:

| Key | Drives |
| --- | --- |
| `appName` | Browser title, nav brand, login header, SMS message prefix |
| `longName` | Cognito invite/reset email subjects and the SES From name |
| `tagline` | Login page subtitle |
| `emoji` | Favicon glyph and the brand mark |
| `propertyNoun` | In-app copy — "Kim is at the **cabin**" |
| `priorityUserLabel` | What the first-look member is called — "Mom", "Grandma", "the owner" |
| `priorityUserLabelPossessive` | Possessive form of the same label |
| `inviteIntro` | Opening line of the invite email |

`terraform.tfvars` takes `project` (prefixes every AWS resource name, must be unique
per deployment), `region`, `custom_domain`, `hosted_zone_id`, `reminder_schedule`, and
optionally `provision_sms_number` / `sms_number_type` — see [docs/sms-program.md](docs/sms-program.md)
for what an origination number costs and why US texts don't deliver without one.

Keeping your profile in a separate private repo — with this one as a submodule — lets
you deploy your own instance without forking:

```bash
git submodule add https://github.com/<you>/cabin-management upstream
./upstream/deploy.sh --profile "$PWD"
```

## Deploy

Prereqs: Node 22+, Terraform ≥ 1.5, AWS credentials with admin-ish rights, us-east-1
(ACM certs for CloudFront must live there).

```bash
(cd backend && npm install)
(cd frontend && npm install)

cp -r profile.example my-profile     # then edit both files in it
./deploy.sh --profile my-profile     # add -auto-approve to skip the plan prompt
```

First-time setup after the initial apply:

```bash
# With remote state, drop the -state flag; Terraform reads the configured backend.
export TABLE_NAME=$(cd infra && terraform output -state=../my-profile/terraform.tfstate -raw table_name)
export USER_POOL_ID=$(cd infra && terraform output -state=../my-profile/terraform.tfstate -raw user_pool_id)

# Seed the maintenance backlog + supply list (idempotent).
# Pass your own JSON file to override backend/scripts/seed-data.example.json.
node backend/scripts/seed.mjs

# Create the first admin — Cognito emails them a temporary password.
node backend/scripts/create-user.mjs you@example.com "Your Name" admin +15551234567
```

Everyone else is invited from the **Admin** page in the app.

### Remote state

State defaults to a file in the profile directory, which is fine for a first look but
means one machine holds the only copy. To move it to S3:

```bash
./scripts/bootstrap-state.sh my-tfstate-bucket us-east-1
cp profile.example/backend.hcl.example my-profile/backend.hcl   # then edit it
```

The bucket is created versioned, encrypted, TLS-only, with public access blocked and
old versions expiring after 90 days. `deploy.sh` picks up `backend.hcl` automatically
and generates `infra/backend.tf` from it.

Migrating a deployment that already has local state is a one-time step — `deploy.sh`
refuses to run until you do it, rather than applying against empty remote state and
orphaning your resources:

```bash
(cd infra && terraform init -migrate-state \
   -backend-config=../my-profile/backend.hcl \
   -state=../my-profile/terraform.tfstate)
mv my-profile/terraform.tfstate my-profile/terraform.tfstate.pre-s3
```

Locking uses a DynamoDB table for compatibility with Terraform < 1.10. On 1.10+ you can
drop `dynamodb_table` from `backend.hcl`, add `use_lockfile = true`, and delete the table.

### Deploying from CI instead of a laptop

A profile repo can run `deploy.sh` from GitHub Actions with no stored AWS keys. Set
these in the profile's `terraform.tfvars` and apply once by hand to create the role:

```hcl
cicd_repo         = "you/your-profile-repo"
cicd_environment  = "prod"            # must match the workflow's `environment:`
cicd_state_bucket = "my-tfstate-bucket"
cicd_lock_table   = "terraform-locks"
```

Then save `terraform output cicd_role_arn` as the profile repo's `AWS_DEPLOY_ROLE_ARN`
variable. From then on, merges to the profile's `main` deploy through the environment's
approval gate.

Two things to know. The role trusts the OIDC subject
`repo:<owner>/<repo>:environment:<cicd_environment>` — GitHub mints the environment
form, not the branch ref, for any job that declares an `environment:`, so the names must
match exactly or every deploy fails at assume-role. And `cicd_create_oidc_provider`
defaults to `false`: flip it to `true` only if this is the first stack in the account to
use GitHub OIDC.

### Custom domain

The site works out of the box on the CloudFront URL (`terraform output site_url`). For a
custom domain, set `custom_domain` and `hosted_zone_id` (a Route 53 zone in the same
account) in your profile's `terraform.tfvars` and redeploy. The ACM cert, DNS validation,
alias record, and SES identity are all created for you.

### Sandbox limits on a new AWS account

Two one-time asks that AWS reviews manually:

- **SES sandbox** — invite and password-reset emails only reach verified addresses until
  you request production access.
- **SNS SMS sandbox** — texts only reach verified numbers. Either verify each member's
  number (`aws sns create-sms-sandbox-phone-number`) or exit the sandbox in the SNS
  console. Until then sends fail gracefully and show up in Admin → notification log.

## How the rules work

- **First look:** dates more than `priorityWindowDays` (default 45) before arrival can only
  be booked by the designated priority user. Inside the window it's first-come-first-served.
  Both the person and the window are set on the Admin page.
- **Yardwork reminders** (daily, `reminder_schedule`, default 15:00 UTC):
  - Checkout day and the next visit is more than `vacancyThresholdDays` (default 14) away
    → "mow before you go" text.
  - Arrival day (or `preVisitReminderDays` before) and the last logged mow is older than the
    threshold → "mow on arrival" text. Logging a mow resets the clock.
  - Pre-visit texts also list every supply currently marked low or out.
- **Overlap prevention:** same-day turnover is allowed — one stay may end the day another starts.

## Dev

```bash
cd backend  && npm run typecheck
cd frontend && npm run dev      # http://localhost:5173, allowed by API CORS
```

`npm run dev` uses `profile.example` unless you set `CABIN_CONFIG` to another
`cabin.config.json`.

## End-to-end tests

A [Playwright](https://playwright.dev) suite in `frontend/e2e/` drives a real browser
against a **deployed** instance, signing in through Cognito and exercising every page:
reservations (create/edit/cancel), supplies, projects and the contribution ledger,
yardwork, profile, and the admin screen. The tests create only clearly-marked data
(`[e2e]` prefix) and delete it as they go; a global teardown sweeps anything a failed run
leaves behind.

**1. Provision a dedicated test account.** Unlike a normal invite, this sets a permanent
password directly (no email, no first-login challenge) so the browser can sign in:

```bash
export USER_POOL_ID=$(cd infra && terraform output -raw user_pool_id)   # add -state=... for local state
export TABLE_NAME=$(cd infra && terraform output -raw table_name)
TEST_USER_EMAIL='playwright-e2e@your-domain.example.com' \
TEST_USER_PASSWORD='a-strong-password-10+chars-with-a-number' \
TEST_USER_NAME='Playwright E2E' \
node backend/scripts/create-test-user.mjs admin      # 'admin' also covers the Admin page
```

**2. Configure credentials.** Copy `frontend/.env.example` to `frontend/.env` (gitignored)
and fill in `E2E_BASE_URL`, `E2E_EMAIL`, and `E2E_PASSWORD`. The API URL, user pool, and
client default to the `VITE_*` values already in that file.

**3. Run it.**

```bash
cd frontend
npm install                 # first time: pulls @playwright/test
npx playwright install chromium
npm run test:e2e            # headless; add `:ui` for the interactive runner
```

The suite runs single-worker on purpose — it mutates shared live data, so parallel runs
against one deployment could collide. It is safe to point at production: advancing a project's
status and adding a contribution would otherwise text every profile with a phone on file and
write notification-log rows that nothing can delete, so `globalSetup` turns
`notifyOnProjectUpdates` off for the duration of the run and `globalTeardown` restores it. That
guard is why the test account needs `admin` — if the flag can't be set, the run aborts rather
than proceed. The only lasting footprint is one marked yardwork log per run (type `other`, which
doesn't affect the mow reminder clock), because chore logs have no delete endpoint.

## Releases

Conventional commits on `main` drive [release-please](.github/workflows/release.yml):
merging the release PR tags `vX.Y.Z`, cuts a GitHub Release, and updates `CHANGELOG.md`.
Each release carries the prebuilt `layer.zip` as an asset, so a deployment can fetch the
exact sharp/libheif layer that version was tested with instead of spending 45 minutes
rebuilding it.

Profile repos should pin their `upstream/` submodule to a release tag rather than to a
bare commit, so what's deployed is a version number:

```bash
git -C upstream fetch --tags && git -C upstream checkout v1.2.3
git commit -am "chore(deps): bump cabin-management to v1.2.3"
```

## Upgrading an existing deployment

The first-look settings were renamed (`momFirstLookDays` → `priorityWindowDays`,
`momUserId` → `priorityUserId`). If your table predates that, run once:

```bash
TABLE_NAME=<table> node backend/scripts/migrate-priority-settings.mjs
```

## License

MIT — see [LICENSE](LICENSE).
