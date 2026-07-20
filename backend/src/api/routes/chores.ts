import { randomUUID } from "node:crypto";
import { ddb, PutCommand, TABLE, queryType } from "../../lib/db.js";
import { ApiError, assertDate, todayISO, type Caller } from "../../lib/http.js";
import { getProfile } from "../../lib/users.js";

export interface ChoreLog {
  id: string;
  type: "mow" | "trim" | "other";
  note: string;
  completedBy: string;
  completedByName: string;
  completedDate: string;
}

const TYPES = new Set(["mow", "trim", "other"]);

export async function listChores(): Promise<ChoreLog[]> {
  const items = await queryType<ChoreLog>("CHORE");
  return items.sort((a, b) => b.completedDate.localeCompare(a.completedDate)).slice(0, 100);
}

export async function logChore(caller: Caller, body: { type?: unknown; note?: unknown; completedDate?: unknown }): Promise<ChoreLog> {
  if (typeof body.type !== "string" || !TYPES.has(body.type)) throw new ApiError(400, "type must be mow, trim, or other");
  const completedDate = body.completedDate !== undefined ? assertDate(body.completedDate, "completedDate") : todayISO();
  if (completedDate > todayISO()) throw new ApiError(400, "completedDate cannot be in the future");
  const profile = await getProfile(caller.sub);
  const log: ChoreLog = {
    id: randomUUID(),
    type: body.type as ChoreLog["type"],
    note: typeof body.note === "string" ? body.note : "",
    completedBy: caller.sub,
    completedByName: profile?.name ?? caller.name,
    completedDate,
  };
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: { PK: `CHORE#${log.id}`, SK: "META", GSI1PK: "CHORE", GSI1SK: log.completedDate, ...log },
    })
  );
  return log;
}
