import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

export const TABLE = process.env.TABLE_NAME!;

const client = new DynamoDBClient({});
export const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

export { GetCommand, PutCommand, QueryCommand, DeleteCommand, UpdateCommand };

/** Query all items of one entity type via GSI1 (GSI1PK = entity type, GSI1SK = sort field). */
export async function queryType<T = Record<string, unknown>>(type: string, opts?: { skBetween?: [string, string] }): Promise<T[]> {
  const items: T[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: "GSI1",
        KeyConditionExpression: opts?.skBetween
          ? "GSI1PK = :pk AND GSI1SK BETWEEN :from AND :to"
          : "GSI1PK = :pk",
        ExpressionAttributeValues: {
          ":pk": type,
          ...(opts?.skBetween ? { ":from": opts.skBetween[0], ":to": opts.skBetween[1] } : {}),
        },
        ExclusiveStartKey: lastKey,
      })
    );
    items.push(...((res.Items ?? []) as T[]));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

export interface Settings {
  priorityWindowDays: number;
  vacancyThresholdDays: number;
  preVisitReminderDays: number;
  priorityUserId: string | null;
  notifyOnProjectUpdates: boolean;
  /** Post-checkout SMS nudge to add a guestbook entry (PRD 5.10). Off by default. */
  guestbookNudgeEnabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  priorityWindowDays: 45,
  vacancyThresholdDays: 14,
  preVisitReminderDays: 3,
  priorityUserId: null,
  notifyOnProjectUpdates: true,
  guestbookNudgeEnabled: false,
};

export async function getSettings(): Promise<Settings> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: "SETTINGS", SK: "META" } }));
  return { ...DEFAULT_SETTINGS, ...(res.Item ?? {}) } as Settings;
}
