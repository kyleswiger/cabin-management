#!/usr/bin/env node
// Seed the maintenance backlog and starter supply checklist for a new deployment.
// Idempotent: skips seeding a category if any item of that type already exists.
// Usage: TABLE_NAME=<table> node scripts/seed.mjs [seed-data.json]
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TABLE = process.env.TABLE_NAME;
if (!TABLE) {
  console.error("Set TABLE_NAME");
  process.exit(1);
}
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });

async function hasAny(type) {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": type },
      Limit: 1,
    })
  );
  return (res.Items ?? []).length > 0;
}

const now = new Date().toISOString();

// A deployment supplies its own backlog and supply list; the example file is a
// generic starting point.
const dataFile =
  process.argv[2] ?? fileURLToPath(new URL("seed-data.example.json", import.meta.url));
const { projects, supplies } = JSON.parse(readFileSync(dataFile, "utf8"));
console.log(`Seeding from ${dataFile}`);

if (await hasAny("PROJECT")) {
  console.log("Projects already seeded, skipping.");
} else {
  for (const p of projects) {
    const id = randomUUID();
    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: { PK: `PROJECT#${id}`, SK: "META", GSI1PK: "PROJECT", GSI1SK: now, id, createdAt: now, ...p },
      })
    );
    console.log(`Seeded project: ${p.title}`);
  }
}

if (await hasAny("SUPPLY")) {
  console.log("Supplies already seeded, skipping.");
} else {
  for (const name of supplies) {
    const id = randomUUID();
    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          PK: `SUPPLY#${id}`,
          SK: "META",
          GSI1PK: "SUPPLY",
          GSI1SK: name.toLowerCase(),
          id,
          name,
          status: "ok",
          lastUpdatedBy: "seed",
          lastUpdatedDate: now,
        },
      })
    );
    console.log(`Seeded supply: ${name}`);
  }
}

console.log("Seed complete.");
