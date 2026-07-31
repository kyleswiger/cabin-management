import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { logNotification } from "./notification-log.js";
import { APP_NAME } from "./branding.js";

const ses = new SESv2Client({});

/** Set by Terraform from the profile's custom_domain. Absent in local runs and tests. */
const FROM_ADDRESS = process.env.NOTIFICATION_FROM_ADDRESS || "";
const SITE_URL = process.env.SITE_URL || "";

/**
 * Send a notification email and record it in the notification log. Never throws — a mail failure
 * must not break the API path, same contract as sendSms().
 *
 * Unlike SMS, `status: "accepted"` here is a genuinely stronger signal: the SES account is out of
 * sandbox with a verified domain identity, DKIM, an aligned MAIL FROM, and DMARC, so acceptance
 * means SES has taken the message for delivery. Bounces and complaints still resolve
 * asynchronously — they land on the SES suppression list and in the account's reputation metrics,
 * not here.
 *
 * Email is deliberately NOT gated on `smsConsent`. Transactional mail to an invited member at the
 * address they were invited on is a different consent basis than carrier-regulated SMS; the
 * separate `emailOptIn` flag governs it and defaults to on.
 */
export async function sendEmail(opts: {
  userId: string;
  email: string | undefined | null;
  optedIn?: boolean;
  type: string;
  subject: string;
  message: string;
}): Promise<void> {
  const { userId, email, optedIn, type, subject, message } = opts;
  let status: string;
  let messageId: string | null = null;

  if (!FROM_ADDRESS) {
    // No custom domain configured for this deployment — there is no verified identity to send
    // from, so skip loudly rather than throwing an SES error per recipient.
    status = "skipped_no_sender";
  } else if (!email) {
    status = "skipped_no_email";
  } else if (optedIn === false) {
    status = "skipped_no_optin";
  } else {
    try {
      const res = await ses.send(
        new SendEmailCommand({
          FromEmailAddress: `${APP_NAME} <${FROM_ADDRESS}>`,
          Destination: { ToAddresses: [email] },
          Content: {
            Simple: {
              Subject: { Data: subject, Charset: "UTF-8" },
              Body: { Text: { Data: bodyWithFooter(message), Charset: "UTF-8" } },
            },
          },
        })
      );
      messageId = res.MessageId ?? null;
      status = "accepted";
    } catch (err) {
      console.error(`Email to ${userId} failed:`, err);
      status = `failed: ${(err as Error).message}`;
    }
  }

  await logNotification({ userId, channel: "email", type, status, messageId, message });
}

function bodyWithFooter(message: string): string {
  const footer = SITE_URL
    ? `\n\n—\n${APP_NAME}\nManage your notification settings: ${SITE_URL}/profile`
    : `\n\n—\n${APP_NAME}`;
  return `${message}${footer}`;
}
