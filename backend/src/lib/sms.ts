import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { ddb, PutCommand, TABLE } from "./db.js";
import { randomUUID } from "node:crypto";

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
 */
export async function sendSms(opts: { userId: string; phone: string | undefined | null; type: string; message: string }): Promise<void> {
  const { userId, phone, type, message } = opts;
  let status = "skipped_no_phone";
  let messageId: string | null = null;
  if (phone) {
    try {
      const res = await sns.send(new PublishCommand({ PhoneNumber: phone, Message: message }));
      messageId = res.MessageId ?? null;
      status = "accepted";
    } catch (err) {
      console.error(`SMS to ${userId} failed:`, err);
      status = `failed: ${(err as Error).message}`;
    }
  }
  try {
    const id = randomUUID();
    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          PK: `NOTIF#${id}`,
          SK: "META",
          GSI1PK: "NOTIF",
          GSI1SK: new Date().toISOString(),
          id,
          userId,
          type,
          status,
          messageId,
          message,
          sentDate: new Date().toISOString(),
        },
      })
    );
  } catch (err) {
    console.error("Failed to write notification log:", err);
  }
}
