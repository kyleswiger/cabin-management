import { ddb, GetCommand, PutCommand, TABLE, queryType } from "./db.js";
import type { Caller } from "./http.js";

export interface Profile {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: "admin" | "member";
}

export async function getProfile(sub: string): Promise<Profile | null> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: `USER#${sub}`, SK: "PROFILE" } }));
  return (res.Item as Profile) ?? null;
}

export async function putProfile(p: Profile): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        PK: `USER#${p.id}`,
        SK: "PROFILE",
        GSI1PK: "USER",
        GSI1SK: p.name.toLowerCase(),
        ...p,
      },
    })
  );
}

export async function listProfiles(): Promise<Profile[]> {
  return queryType<Profile>("USER");
}

/** Get profile, creating a bare one from token claims on first login. */
export async function ensureProfile(caller: Caller): Promise<Profile> {
  const existing = await getProfile(caller.sub);
  if (existing) return existing;
  const profile: Profile = {
    id: caller.sub,
    name: caller.name || caller.email,
    email: caller.email,
    phone: null,
    role: caller.isAdmin ? "admin" : "member",
  };
  await putProfile(profile);
  return profile;
}
