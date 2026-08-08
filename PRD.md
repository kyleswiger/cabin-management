# Cabin Management Site — Product Requirements Document

**Status:** Draft v2
**Owner:** Property admin
**Last updated:** 2026-08-07

## 1. Problem Statement

A shared property has no common system for tracking who's using it, what needs to be done before/after a visit, or what shape it's in. As a result:

- Maintenance items (roof, ceiling paint, connectivity, security) sit unaddressed with no owner or visibility into cost-sharing.
- Nonperishables and supplies run out because nobody knows what the last visitor used or left behind.
- Yardwork (mowing, trimming) gets skipped, especially during stretches when no one is scheduled to visit, letting the property look neglected.
- Reservations are coordinated ad hoc (texts/calls), with no consistent way to honor a priority member's scheduling preference or avoid double-booking.

## 2. Goals

1. Give the member group a single private place to reserve the property, see who's coming/going, and avoid conflicts.
2. Automatically remind whoever is heading up (or just left) what to bring, buy, or do — based on who was last there and who's coming next.
3. Track the maintenance/project backlog and who has chipped in, so overdue items don't get forgotten.
4. Keep the whole thing running for near-zero ongoing AWS cost — fully serverless, nothing billed by the hour.
5. Keep access private to the member group, with a low-friction login.

## 3. Non-Goals

- No public marketing site or listing (this is not a rental).
- No payment processing integration (Venmo/PayPal/etc.) — contribution tracking is a ledger, not a payment gateway.
- No native mobile app — a responsive web app is sufficient.
- No dynamic/variable pricing or booking-fee logic.
- No integration with the security camera video feed itself in v1 (see §10 Future Work).

## 4. Users

Small, fixed group (~2–6 households). No public signup — every account is provisioned/invited by an admin.

| Role | Description |
|---|---|
| **Admin** | Can invite/remove users, edit the maintenance backlog, adjust reservation rules (e.g. the first-look window length). |
| **Member** | Everyone else. Can reserve dates, log chores, update the supply list, log contributions toward projects. |
| **Priority member** | A Member with one special attribute: first-look priority on the reservation calendar (see §5.2). The label is configurable per deployment — "Mom", "Grandma", "the owner". |

## 5. Key Features

### 5.1 Private Login
- Invite-only accounts (admin creates the user or sends an email invite; no open registration).
- Email + password login. No third-party/social login needed.
- Session-based access to the whole site — nothing is publicly viewable without login.

### 5.2 Reservation Calendar
- Calendar view of booked/open date ranges.
- Anyone can request a date range; the system prevents overlapping bookings.
- **First-look window:** for any date range, the priority member has an exclusive right to claim it until **N days before the start date** (default: 45, admin-configurable). Before that cutoff, only they can book that range; other members can see it's held but cannot book over it. After the cutoff, if it hasn't been claimed, it opens up first-come-first-served to everyone.
- Each reservation captures: who's attending, arrival date, departure date, optional notes.
- Editing/cancelling a reservation notifies anyone materially affected (e.g., if it changes the vacancy window driving a chore reminder).

### 5.3 Occupancy-Aware Chore Reminders (Yardwork)
- The system tracks the **last checkout date** and the **next reservation start date** at all times.
- Mowing/trimming reminders are computed from the *vacancy gap*, not a fixed calendar schedule:
  - If the gap before the next visit exceeds a threshold (default: 14 days, admin-configurable), the person checking out is reminded to mow/trim **before leaving**, since no one will be up for a while.
  - If a new reservation is added into a long-vacant stretch, the upcoming visitor gets a reminder to mow/trim **on arrival** if it's been too long since the last cut.
  - A simple "yardwork log" (gas mower + electric string trimmer, done: yes/no, date) is filled in by whoever does it, which resets the clock.
- Reminder logic runs on a schedule (not on-demand), so it fires even if no one is actively using the site that day.

### 5.4 Stock-Up / Supply Checklist
- A shared, persistent checklist of nonperishables/recurring supplies (toilet paper, cleaning supplies, firewood, s'mores, etc.), editable by anyone.
- Items are marked **low/out** by whoever notices during a visit.
- Anyone with an upcoming reservation gets a reminder (see §5.6) listing current low/out items as a "grab this on your way up" list.
- Admin/members can add/remove checklist items as needs change (it's a living list, not fixed).

### 5.5 Maintenance & Project Tracker
- Backlog of known projects, seeded at launch (see §9), each with: description, status (Not Started / In Progress / Done), rough cost estimate, and priority.
- Each project has a lightweight **contribution ledger**: household X chipped in $Y on date Z. This is a running log, not a bill-splitting/payment engine — it just gives visibility into who's contributed and the running total vs. estimated cost.
- Anyone can add a new project to the backlog (e.g., "gutter cleaning needed").

### 5.6 Notifications (SMS)
- Delivered via SMS (SNS), to the phone number on each member's profile.
- Triggered reminders:
  - **N days before an upcoming reservation:** supply checklist low/out items + any pending chore expectations (e.g., "mow before you go" if it hasn't been done in a while).
  - **On checkout, if the next reservation is far off:** yardwork reminder before leaving.
  - **Project updates:** optional notification when a project's status changes or a contribution is logged.
- SMS is the only channel for v1 (per product decision); email may be added later as a fallback channel if SNS SMS costs or deliverability become an issue.

### 5.7 Dashboard (Home Page)
- At-a-glance view after login: next reservation, who's currently at the cabin (if anyone), current supply low/out items, open maintenance items, last time yardwork was logged, pending print-queue count (§5.9), and the latest guestbook entry (§5.10).

### 5.8 Photo Gallery
Two kinds of albums, one shared media pipeline:

- **Trip albums** — general photos/videos from visits ("July 4th weekend"), optionally linked to a reservation or guestbook entry. Anyone can create an album and upload to any album.
- **Reference albums** — living "current state of X" documentation: the yard, the fridge, the pantry/dry storage, the water shutoff, the breaker panel. The newest photo in a reference album is treated as the canonical "here's what it looks like right now" shot; older photos are kept as history. The Supplies page links to the fridge/pantry reference albums so "what's actually up there" is one tap from the checklist. **Creating reference albums is admin-only** (keeps the set tidy); uploading into them is open to all members. Seeded at launch — see §9.

Mechanics:

- **Upload:** the browser PUTs the *original file, untouched and in its native format* (JPEG, HEIC/HEIF from iPhone or Android, MOV/HEVC, MP4) straight to S3 via a presigned URL from the API. Originals are the archival copy — kept forever in the original format for later retrieval at full quality.
- **Processing:** an S3 upload event triggers a media-processing Lambda that writes web derivatives alongside the original: photos get a web-size JPEG (~2560px long edge) + thumbnail; videos get a poster frame, and non-web-playable formats (HEVC .mov) get an H.264 MP4 via an on-demand MediaConvert job. Image work uses **sharp on a custom Lambda layer** (libvips compiled with libheif for HEIC/HEIF decode — the prebuilt sharp binaries exclude it), built reproducibly via a Docker script checked into the repo. Native-speed conversion keeps per-image processing sub-second at any realistic volume. The gallery UI shows items as "processing" until derivatives land.
- **Viewing:** the media bucket is fully private, served through a `/media/*` CloudFront behavior (Origin Access Control) gated by **CloudFront signed cookies** issued at login — one auth decision per session, full CDN caching, no per-object URL churn. Requires a CloudFront key group: public key in Terraform, private signing key in SSM, cookies set by the API after Cognito auth. (Presigned GET URLs were the simpler alternative, but signed cookies cache better and the implementation is deliberately worth the practice.)
- **Metadata:** caption, uploaded-by, optional taken-date. Delete is uploader-or-admin and removes original + derivatives.
- **Storage/cost:** lifecycle rules split by prefix — derivatives → Infrequent Access after 90 days; originals → Glacier Instant Retrieval after 90 days (~$0.004/GB-mo, still instantly retrievable). Even 50 GB of originals ≈ $0.20/mo at rest. MediaConvert is pay-per-job (~$0.01–0.02/min of video) with zero idle cost.

### 5.9 Print Queue
The physical cabin album/wall, fed by the digital gallery:

- Any member can flag any photo "print this" from the gallery.
- A queue page lists flagged photos with who requested each; whoever has the photo printer works through it between trips and marks items printed (date logged automatically).
- The printed history doubles as the record of what's already in the physical album — no duplicate prints.
- Dashboard surfaces the pending count so the printer-owner sees new requests without being nagged.

### 5.10 Guestbook
A digital version of the classic cabin logbook:

- One entry per visit: title, free-text story, visit dates (pre-filled from the author's most recent reservation when there is one), and optional linked photos from the gallery.
- Reverse-chronological reading view visible to all members; edit is author-or-admin.
- Optional post-checkout SMS nudge ("add a guestbook entry for your trip") piggybacks on the existing daily reminders Lambda — admin-toggleable in Settings, off by default.

### 5.11 Local Treks & Area Guide
A curated directory of what's around, so nobody re-researches the same trail or drives past the good hardware store:

- Entries have: name, category (**hike/paddle**, **food & drink**, **attraction**, **essentials** — grocery, hardware, dump station, urgent care), description/tips, drive time from the cabin, and an external link (Google Maps / AllTrails).
- Anyone can add or edit entries — it's a living guide like the supply checklist, not admin-curated content.
- Guestbook entries pair naturally ("we did the falls loop — see the trek entry"), but cross-linking is future work (§10), not v1 of this feature.

## 6. Architecture (fully serverless, AWS)

No persistent/always-on compute (no EC2, no RDS, no ECS services). Everything scales to zero when idle.

```
Browser
  │
  ├── Route 53 (custom domain) + ACM (TLS)
  │
  ├── CloudFront ── S3 (static site: React/Vite SPA build)
  │        └── /media/* behavior (signed cookies + OAC) ── S3 (private media bucket)
  │
  └── CloudFront/API Gateway (HTTP API) ── AWS Lambda ── DynamoDB (on-demand)
                                              │
                                              ├── Cognito User Pool (auth, invite-only)
                                              ├── SNS (SMS notifications)
                                              ├── S3 media bucket (presigned PUT for uploads)
                                              │      └── S3 event → media-processing Lambda ── MediaConvert (video, on-demand)
                                              └── EventBridge Scheduler (daily cron → reminder-evaluation Lambda)
```

| Concern | Service | Notes |
|---|---|---|
| Static frontend | S3 + CloudFront | Private S3 bucket via Origin Access Control; CloudFront serves the SPA. |
| Domain/TLS | Route 53 + ACM | Uses your existing domain — subdomain (e.g. `cabin.yourdomain.com`) or standalone domain, whichever you already hold. |
| Auth | Cognito User Pool | Invite-only user creation (admin/API-triggered `AdminCreateUser`), no public sign-up flow enabled. Issues JWTs consumed by API Gateway authorizer. |
| API | API Gateway (HTTP API) + Lambda | One Lambda per resource area (reservations, chores, supplies, projects) or a single Lambda with internal routing — implementation detail, not a v1 requirement either way. |
| Data | DynamoDB (on-demand billing) | Single table or a handful of small tables; no provisioned capacity to manage. |
| Scheduled reminders | EventBridge Scheduler + Lambda | Runs daily, evaluates vacancy gaps/upcoming reservations, publishes to SNS. |
| Media storage | S3 (separate private media bucket) | Originals uploaded via presigned PUT, kept forever in native format; derivatives written by the processing Lambda. Lifecycle by prefix: derivatives → IA, originals → Glacier Instant Retrieval, both at 90 days. |
| Media serving | CloudFront `/media/*` + signed cookies | Same distribution as the SPA (so cookies flow); OAC to the media bucket; key group public key in Terraform, private signing key in SSM; API sets the cookies at login. |
| Media processing | Lambda (S3 event) + MediaConvert | Lambda: HEIC→JPEG, web-size + thumbnail, video poster frames via sharp on a custom layer (libvips + libheif, Docker-built). MediaConvert: H.264 MP4 only for non-web-playable video, pay-per-job. |
| Notifications | SNS (SMS) | Requires moving the AWS account SMS spend out of the default sandbox limit — a one-time account setup step. |
| IaC | Terraform | The whole stack is one self-contained Terraform root module with its own state — it shares nothing with any other project. |

**Estimated monthly cost at this scale (~2–6 users, a handful of reservations/month):** low single-digit dollars — dominated by SNS SMS send costs (~$0.0065–0.01/message in the US) and Route 53 hosted zone (~$0.50/mo) if a new zone is needed; S3, CloudFront, Lambda, API Gateway, DynamoDB, and Cognito all fall well within free-tier or near-zero usage-based pricing at this volume.

## 7. Data Model (high level)

| Entity | Key fields |
|---|---|
| **User** | id, name, email, phone (E.164), role (admin/member); the priority member is referenced by id in Settings |
| **Reservation** | id, start_date, end_date, created_by, attendees, notes, status |
| **ChoreLog** | id, type (mow/trim/other), completed_by, completed_date |
| **SupplyItem** | id, name, status (ok/low/out), last_updated_by, last_updated_date |
| **Project** | id, title, description, status, priority, estimated_cost |
| **Contribution** | id, project_id, user_id, amount, date, note |
| **NotificationLog** | id, user_id, type, sent_date, payload (for debugging/audit, not user-facing) |
| **Album** | id, type (trip/reference), title, created_by; reference albums carry a well-known slug (yard, fridge, pantry) for deep links |
| **MediaItem** | id, album_id, media_type (photo/video), original_key, original_format, web_key, thumb_key, poster_key, processing_status, caption, uploaded_by, taken_date, print_status (none/requested/printed — photos only), print_requested_by, printed_date |
| **GuestbookEntry** | id, author, title, body, visit_start, visit_end, media_ids |
| **Trek** | id, name, category (hike/food/attraction/essentials), description, drive_minutes, link, added_by |

## 8. Non-Functional Requirements

- **Privacy:** No page or API route accessible without authentication; S3/CloudFront origin is private (no direct bucket access).
- **Cost:** Strictly pay-per-use services only; no NAT gateways, no always-on compute, no provisioned DB capacity.
- **Reliability:** Scheduled reminder job must run daily even with zero active users (EventBridge, not a browser-triggered check).
- **Simplicity of ops:** Small user base — no need for multi-region, autoscaling policies, or elaborate observability; basic CloudWatch logs/alarms are sufficient.

## 9. Seed Data (initial content at launch)

### 9.1 Maintenance backlog

| Item | Notes |
|---|---|
| Roof moss removal / aging roof | Overdue |
| Ceiling plaster peeling paint (both original bedrooms) | Overdue |
| Blackstone griddle purchase | New item to chip in for |
| T-Mobile 5G signal reliability (booster/antenna) | Internet service itself is new as of June 2026; this is about strengthening it |
| Security cameras | New install |
| Ethernet cabling (wired backhaul for cameras/AP) | New install, likely paired with camera project |

### 9.2 Reference albums (admin-only creation, see §5.8)

| Album | Why |
|---|---|
| Yard & grounds | Drives the "does it need mowed" call without asking whoever was last up |
| Fridge | Linked from the Supplies page — what's actually there before shopping |
| Pantry & dry goods | Same, for nonperishables |
| Firewood | Stock level before a cold-weather trip |
| Water shutoff / well | Find-it-fast documentation for open/close-up and emergencies |
| Electrical panel | Which breaker is which |
| Roof & gutters | Condition history — pairs with the roof moss backlog item |

### 9.3 Area guide (§5.11)

| Name | Category | Notes |
|---|---|---|
| Ohiopyle State Park | Hike/paddle | White water rafting, hiking, biking, swimming, natural water slides |
| Quebec Run Wild Area | Hike/paddle | Family Reunion Hiking Trail |
| Fort Necessity | Attraction | National battlefield |
| Uniontown | Essentials | Walmart, Home Depot, Lowe's, GameStop, vape store, etc. |
| Braddock's Inn | Food & drink | Restaurant and tavern |
| Maywood Grill | Food & drink | Breakfast and lunch |

## 10. Future Work (explicitly out of scope for v1)

- Email as a secondary notification channel.
- Photo attachments on projects/chores (e.g., "here's the roof moss") — straightforward once the §5.8 media pipeline exists; a project photo is just a photo whose parent is a project instead of an album.
- Cross-linking guestbook entries to treks ("we did the falls loop" → the trek entry).
- A "cabin manual": how-to guides (water on/off, septic rules, wood stove) pairing §5.8 reference photos with step-by-step instructions.
- Map view for the area guide (pins for treks/essentials).
- Weather-aware reminders (e.g., skip mow reminder if snow-covered).
- Direct links to camera footage/clips once cameras are installed.
- Guest-mode / temporary access for visitors outside the member group.

## 11. Open Questions

1. Which domain (or subdomain of an existing one) should the site use, and is the Route 53 hosted zone already in this AWS account?
2. Is a single shared AWS account fine for this (same account as other projects), or should this live in its own AWS account for blast-radius isolation?
3. Default vacancy threshold for yardwork reminders — is 14 days the right number, or should it vary by season (e.g., shorter in peak summer growth)?
4. Should the first-look window (default 45 days) differ by season/holiday, or is a flat number fine?
5. Who beyond the initial owner should have Admin rights (backlog editing, user invites)?
6. Should the print queue notify the printer-owner (SMS) when a request lands, or is the dashboard count enough?

## 12. Phased Rollout

- **Phase 1 (MVP):** Private login, reservation calendar with the first-look rule, supply checklist, seeded maintenance backlog (read/update, no ledger yet).
- **Phase 2:** SMS notifications (pre-visit reminders, checkout reminders), occupancy-driven yardwork reminder logic, project contribution ledger.
- **Phase 3:** Dashboard polish.
- **Phase 4 — Media:** photo/video gallery with trip + reference albums (§5.8), print queue (§5.9). This lands the media pipeline — presigned uploads of originals, S3-event processing Lambda (HEIC conversion, thumbnails, MediaConvert for video), CloudFront signed-cookie serving — that later media features build on.
- **Phase 5 — Memories & area guide:** guestbook (§5.10), local treks directory (§5.11), optional post-checkout guestbook nudge, dashboard tiles for print count and latest guestbook entry.
- **Beyond:** remaining future-work items from §10 as prioritized.
