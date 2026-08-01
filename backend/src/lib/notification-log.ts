import { ddb, PutCommand, TABLE } from "./db.js";
import { randomUUID } from "node:crypto";

/**
 * Write one `NOTIF` row. Shared by sendSms() and sendEmail() so both channels land in the same
 * Admin → notification log with the same shape; `channel` is what tells them apart.
 *
 * Never throws. A failure to record a notification must not fail the send that already happened,
 * and must not break the API path that triggered it.
 */
export async function logNotification(opts: {
  userId: string;
  channel: "sms" | "email";
  type: string;
  status: string;
  messageId: string | null;
  message: string;
}): Promise<void> {
  try {
    const id = randomUUID();
    const now = new Date().toISOString();
    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          PK: `NOTIF#${id}`,
          SK: "META",
          GSI1PK: "NOTIF",
          GSI1SK: now,
          id,
          userId: opts.userId,
          channel: opts.channel,
          type: opts.type,
          status: opts.status,
          messageId: opts.messageId,
          message: opts.message,
          sentDate: now,
        },
      })
    );
  } catch (err) {
    console.error("Failed to write notification log:", err);
  }
}
