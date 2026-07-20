import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { ddb, PutCommand, TABLE } from "./db.js";
import { randomUUID } from "node:crypto";

const sns = new SNSClient({});

/** Send an SMS and record it in the notification log. Never throws — SMS failure must not break the API path. */
export async function sendSms(opts: { userId: string; phone: string | undefined | null; type: string; message: string }): Promise<void> {
  const { userId, phone, type, message } = opts;
  let status = "skipped_no_phone";
  if (phone) {
    try {
      await sns.send(new PublishCommand({ PhoneNumber: phone, Message: message }));
      status = "sent";
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
          message,
          sentDate: new Date().toISOString(),
        },
      })
    );
  } catch (err) {
    console.error("Failed to write notification log:", err);
  }
}
