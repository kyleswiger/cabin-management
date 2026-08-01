# SMS program: consent, origination numbers, and registration

US SMS has two gates that are easy to confuse. Clearing one does nothing for the other.

1. **AWS account sandbox.** A new account's End User Messaging tier is `SANDBOX`: spend limits are
   pinned at $1 and messages only reach *verified destination numbers*. Publishes to any other
   number are **accepted and then silently dropped** — which is why `sendSms()` records `accepted`
   rather than `sent` (see `backend/src/lib/sms.ts`). Leaving the sandbox is a support case.
2. **Carrier registration of the origination number.** Since 2024, US carriers block traffic from
   unregistered toll-free numbers regardless of your AWS tier. A toll-free number must clear
   **TFN registration**, a human review that has historically taken two to three weeks.

Both must clear before a single text reaches a real phone.

## Consent is a code path, not a policy document

Carriers judge the registration against what the application actually does, and they can ask when a
specific number consented. So consent is enforced in code:

- `Profile.smsConsent` / `Profile.smsConsentAt` (`backend/src/lib/users.ts`) hold the flag and the
  audit timestamp.
- `sendSms()` refuses to publish without it and logs `skipped_no_consent`.
- The box on the profile page is **unchecked by default**. A pre-checked box is not consent and is
  grounds for rejection.
- **An admin cannot consent on a member's behalf.** `inviteUser` and `updateUser` can set a phone
  number but have no path to set `smsConsent`; only the member's own `PUT /me` can.
- Consent is bound to the number that gave it. Changing the phone — from either the member's page
  or an admin edit — clears consent and the timestamp.

The disclosure text lives in two places that must stay consistent, because a reviewer compares
them: the checkbox label in `frontend/src/pages/Profile.tsx`, and the public page at
`frontend/public/sms-terms.html`. Both must state purpose, frequency, that message and data rates
may apply, and HELP/STOP. The public page must be reachable **without logging in** — a site that
shows a carrier reviewer nothing but a password box gets rejected.

## Provisioning the number

`infra/sms.tf` provisions a toll-free origination number, gated on `provision_sms_number` (default
`false`) because the number bills monthly whether or not it is registered. `sms_number_type`
defaults to `TOLL_FREE`.

`deletion_protection_enabled = true` is deliberate: a released number cannot be reclaimed and its
registration goes with it, so losing one means restarting a multi-week approval. The trade-off is
that flipping `provision_sms_number` back to `false`, changing `sms_number_type`, or destroying the
stack will **plan a destroy that fails at apply** — escaping that requires an out-of-band
`aws pinpoint-sms-voice-v2 update-phone-number --no-deletion-protection-enabled` first.

`TEN_DLC` passes variable validation but will fail at apply: AWS requires an approved brand and
campaign registration ID for a 10DLC number, and the resource sets none. Ten-DLC needs the brand
registered first.

## Submitting the registration

Field definitions come from the API, not from documentation that may be stale:

```bash
aws pinpoint-sms-voice-v2 describe-registration-field-definitions \
    --registration-type US_TOLL_FREE_REGISTRATION
```

`optInImage` is a **required attachment** — a screenshot of the live consent checkbox with its full
disclosure text. It cannot be produced before the consent UI is deployed, which is why the UI ships
before the registration is submitted.

```bash
aws pinpoint-sms-voice-v2 create-registration --registration-type US_TOLL_FREE_REGISTRATION
aws pinpoint-sms-voice-v2 create-registration-association \
    --registration-id <id> --resource-arn <phone-number-arn>
aws pinpoint-sms-voice-v2 update-registration-field-value \
    --registration-id <id> --field-path <path> --text-value <value>
aws pinpoint-sms-voice-v2 submit-registration-version --registration-id <id>
```

Message samples must be the **real** strings the app sends (`backend/src/reminders/handler.ts`) —
carriers compare submitted samples against delivered traffic. Monthly volume should be the honest
bracket: a daily reminder schedule across N members is up to ~30N messages per month, and
understating it is its own compliance problem.

## Testing before either gate clears

Verify your own number as a sandbox destination and send to it:

```bash
aws pinpoint-sms-voice-v2 create-verified-destination-number --destination-phone-number +1XXXXXXXXXX
aws pinpoint-sms-voice-v2 send-destination-number-verification-code --verified-destination-number-id <id>
aws pinpoint-sms-voice-v2 verify-destination-number --verified-destination-number-id <id> --verification-code <code>
```

Check `Admin → notification log` for the resulting row. `skipped_no_consent` means the profile never
opted in; `accepted` means SNS took it, which is still not proof of delivery — that lives in SNS
delivery status logs and the `AWS/SNS NumberOfNotificationsFailed` metric.

## Email is not subject to any of this

SES has no carrier gate. Once the domain identity is verified and the account has production
access, `sendEmail()` delivers. It is governed by `Profile.emailOptIn` (default on) rather than
`smsConsent`, because transactional mail to an invited member at the address they were invited on
rests on a different consent basis than carrier-regulated SMS.
