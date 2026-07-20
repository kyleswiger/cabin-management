#!/usr/bin/env node
// One-time migration for deployments created before the "first look" settings
// were renamed: momFirstLookDays -> priorityWindowDays, momUserId -> priorityUserId.
// Idempotent and safe to run against an already-migrated table.
// Usage: TABLE_NAME=<table> node scripts/migrate-priority-settings.mjs
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

const TABLE = process.env.TABLE_NAME;
if (!TABLE) {
  console.error("Set TABLE_NAME");
  process.exit(1);
}
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const key = { PK: "SETTINGS", SK: "META" };
const { Item } = await ddb.send(new GetCommand({ TableName: TABLE, Key: key }));

if (!Item) {
  console.log("No settings record yet — nothing to migrate (defaults apply).");
  process.exit(0);
}

const renames = [
  ["momFirstLookDays", "priorityWindowDays"],
  ["momUserId", "priorityUserId"],
];

const next = { ...Item };
let changed = false;
for (const [from, to] of renames) {
  if (from in next) {
    // A value already under the new name wins; the old key is just dropped.
    if (!(to in next)) next[to] = next[from];
    delete next[from];
    changed = true;
    console.log(`${from} -> ${to}`);
  }
}

if (!changed) {
  console.log("Already migrated.");
  process.exit(0);
}

await ddb.send(new PutCommand({ TableName: TABLE, Item: next }));
console.log("Settings migrated.");
