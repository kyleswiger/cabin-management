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

async function queryAll(type) {
  const items = [];
  let lastKey;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": type },
        ExclusiveStartKey: lastKey,
      })
    );
    items.push(...(res.Items ?? []));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

/** An older profile's seed file predates a category; seeding it would otherwise
 * do nothing without saying so. */
function noteIfEmpty(list, label) {
  if (list.length === 0) {
    console.log(`No ${label} in this seed file — see scripts/seed-data.example.json to add them.`);
    return true;
  }
  return false;
}

const now = new Date().toISOString();

// A deployment supplies its own backlog and supply list; the example file is a
// generic starting point.
const dataFile =
  process.argv[2] ?? fileURLToPath(new URL("seed-data.example.json", import.meta.url));
const { projects, supplies, treks = [], albums = [] } = JSON.parse(readFileSync(dataFile, "utf8"));
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

// Area guide (PRD 5.11, starter entries in PRD 9.3).
if (await hasAny("TREK")) {
  console.log("Treks already seeded, skipping.");
} else if (!noteIfEmpty(treks, "treks")) {
  for (const t of treks) {
    const id = randomUUID();
    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          PK: `TREK#${id}`,
          SK: "META",
          GSI1PK: "TREK",
          GSI1SK: t.name.toLowerCase(),
          id,
          addedBy: "seed",
          addedByName: "seed",
          createdAt: now,
          ...t,
        },
      })
    );
    console.log(`Seeded trek: ${t.name}`);
  }
}

// Reference albums (PRD 5.8, starter set in PRD 9.2) — the "current state of X"
// albums the Supplies page deep-links to. Deliberately NOT gated on hasAny("ALBUM"):
// members create trip albums constantly, and that must never block seeding a
// reference album that doesn't exist yet. Dedupe is per-slug, so adding one to the
// seed file and re-running seeds just the missing one.
if (!noteIfEmpty(albums, "reference albums")) {
  const existingSlugs = new Set(
    (await queryAll("ALBUM")).map((a) => a.slug).filter(Boolean)
  );
  for (const a of albums) {
    // Same invariant the API enforces (createAlbum's SLUG_RE) — a bad slug here
    // would create a row no deep link could reach.
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(a.slug ?? "")) {
      console.error(`Skipped album "${a.title}": slug must be kebab-case (got "${a.slug}")`);
      continue;
    }
    if (existingSlugs.has(a.slug)) {
      console.log(`Album "${a.slug}" already exists, skipping.`);
      continue;
    }
    const id = randomUUID();
    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          ...a,
          PK: `ALBUM#${id}`,
          SK: "META",
          GSI1PK: "ALBUM",
          GSI1SK: a.title.toLowerCase(),
          id,
          type: "reference",
          createdBy: "seed",
          createdAt: now,
        },
      })
    );
    console.log(`Seeded reference album: ${a.title}`);
  }
}

console.log("Seed complete.");
