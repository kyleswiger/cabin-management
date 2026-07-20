import { randomUUID } from "node:crypto";
import { ddb, GetCommand, PutCommand, DeleteCommand, TABLE, queryType } from "../../lib/db.js";
import { ApiError, type Caller } from "../../lib/http.js";
import { getProfile } from "../../lib/users.js";

export interface SupplyItem {
  id: string;
  name: string;
  status: "ok" | "low" | "out";
  lastUpdatedBy: string;
  lastUpdatedDate: string;
}

const STATUSES = new Set(["ok", "low", "out"]);

export async function listSupplies(): Promise<SupplyItem[]> {
  const items = await queryType<SupplyItem>("SUPPLY");
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

async function save(item: SupplyItem): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: { PK: `SUPPLY#${item.id}`, SK: "META", GSI1PK: "SUPPLY", GSI1SK: item.name.toLowerCase(), ...item },
    })
  );
}

export async function createSupply(caller: Caller, body: { name?: unknown; status?: unknown }): Promise<SupplyItem> {
  if (typeof body.name !== "string" || !body.name.trim()) throw new ApiError(400, "name is required");
  const status = typeof body.status === "string" && STATUSES.has(body.status) ? (body.status as SupplyItem["status"]) : "ok";
  const profile = await getProfile(caller.sub);
  const item: SupplyItem = {
    id: randomUUID(),
    name: body.name.trim(),
    status,
    lastUpdatedBy: profile?.name ?? caller.name,
    lastUpdatedDate: new Date().toISOString(),
  };
  await save(item);
  return item;
}

export async function updateSupply(caller: Caller, id: string, body: { name?: unknown; status?: unknown }): Promise<SupplyItem> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: `SUPPLY#${id}`, SK: "META" } }));
  if (!res.Item) throw new ApiError(404, "Supply item not found");
  const existing = res.Item as SupplyItem;
  if (body.status !== undefined && (typeof body.status !== "string" || !STATUSES.has(body.status))) {
    throw new ApiError(400, "status must be ok, low, or out");
  }
  const profile = await getProfile(caller.sub);
  const updated: SupplyItem = {
    ...existing,
    name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : existing.name,
    status: (body.status as SupplyItem["status"]) ?? existing.status,
    lastUpdatedBy: profile?.name ?? caller.name,
    lastUpdatedDate: new Date().toISOString(),
  };
  await save(updated);
  return updated;
}

export async function deleteSupply(id: string): Promise<void> {
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { PK: `SUPPLY#${id}`, SK: "META" } }));
}
