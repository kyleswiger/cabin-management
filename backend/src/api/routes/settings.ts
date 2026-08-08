import { ddb, PutCommand, TABLE, getSettings, type Settings } from "../../lib/db.js";
import { ApiError, type Caller } from "../../lib/http.js";
import { getProfile } from "../../lib/users.js";

export { getSettings };

function parsePositiveInt(value: unknown, field: string, max: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > max) throw new ApiError(400, `${field} must be an integer between 0 and ${max}`);
  return n;
}

export async function updateSettings(caller: Caller, body: Partial<Record<keyof Settings, unknown>>): Promise<Settings> {
  if (!caller.isAdmin) throw new ApiError(403, "Only an admin can change settings");
  const current = await getSettings();
  const updated: Settings = { ...current };

  if (body.priorityWindowDays !== undefined) updated.priorityWindowDays = parsePositiveInt(body.priorityWindowDays, "priorityWindowDays", 365);
  if (body.vacancyThresholdDays !== undefined) updated.vacancyThresholdDays = parsePositiveInt(body.vacancyThresholdDays, "vacancyThresholdDays", 365);
  if (body.preVisitReminderDays !== undefined) updated.preVisitReminderDays = parsePositiveInt(body.preVisitReminderDays, "preVisitReminderDays", 30);
  if (body.notifyOnProjectUpdates !== undefined) updated.notifyOnProjectUpdates = Boolean(body.notifyOnProjectUpdates);
  if (body.guestbookNudgeEnabled !== undefined) updated.guestbookNudgeEnabled = Boolean(body.guestbookNudgeEnabled);
  if (body.priorityUserId !== undefined) {
    if (body.priorityUserId === null || body.priorityUserId === "") {
      updated.priorityUserId = null;
    } else if (typeof body.priorityUserId === "string") {
      const profile = await getProfile(body.priorityUserId);
      if (!profile) throw new ApiError(400, "priorityUserId does not match an existing user");
      updated.priorityUserId = body.priorityUserId;
    } else {
      throw new ApiError(400, "priorityUserId must be a user id or null");
    }
  }

  await ddb.send(new PutCommand({ TableName: TABLE, Item: { PK: "SETTINGS", SK: "META", ...updated } }));
  return updated;
}
