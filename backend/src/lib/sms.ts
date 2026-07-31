import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { logNotification } from "./notification-log.js";

const sns = new SNSClient({});

/**
 * Send an SMS and record it in the notification log. Never throws — SMS failure must not break the API path.
 *
 * Note on `status`: a successful Publish only means SNS *accepted* the message, not that the
 * carrier delivered it. While the account is in the SNS SMS sandbox, publishes to unverified
 * numbers are accepted and then silently dropped, so recording "sent" here would be a lie —
 * it hid a total SMS outage for weeks. We record "accepted" plus the SNS message ID; the real
 * delivery outcome only shows up in SNS delivery status logging and the
 * AWS/SNS NumberOfNotificationsFailed metric.
 *
 * Note on `consent`: US carriers require documented, explicit opt-in per recipient, and the
 * toll-free registration we submit is judged against what this code actually does. A number
 * without recorded consent is `skipped_no_consent` — never "send it anyway and hope". Consent is
 * captured on the profile page and stored as `smsConsent` + `smsConsentAt`.
 */
export async function sendSms(opts: {
  userId: string;
  phone: string | undefined | null;
  consent?: boolean;
  type: string;
  message: string;
}): Promise<void> {
  const { userId, phone, consent, type, message } = opts;
  let status: string;
  let messageId: string | null = null;

  if (!phone) {
    status = "skipped_no_phone";
  } else if (!consent) {
    status = "skipped_no_consent";
  } else {
    try {
      const res = await sns.send(new PublishCommand({ PhoneNumber: phone, Message: message }));
      messageId = res.MessageId ?? null;
      status = "accepted";
    } catch (err) {
      console.error(`SMS to ${userId} failed:`, err);
      status = `failed: ${(err as Error).message}`;
    }
  }

  await logNotification({ userId, channel: "sms", type, status, messageId, message });
}
