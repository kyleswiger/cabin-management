import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { ddb, DeleteCommand, TABLE } from "../../lib/db.js";
import { ApiError, type Caller } from "../../lib/http.js";
import { getProfile, listProfiles, putProfile, ensureProfile, type Profile } from "../../lib/users.js";

const cognito = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID!;

export { listProfiles, ensureProfile };

const PHONE_RE = /^\+[1-9]\d{6,14}$/;

function validatePhone(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !PHONE_RE.test(value)) {
    throw new ApiError(400, "phone must be E.164 format, e.g. +15551234567");
  }
  return value;
}

export async function updateMe(
  caller: Caller,
  body: { name?: unknown; phone?: unknown; smsConsent?: unknown; emailOptIn?: unknown }
): Promise<Profile> {
  const profile = await ensureProfile(caller);
  const phone = body.phone !== undefined ? validatePhone(body.phone) : profile.phone;

  // Consent is bound to the number that gave it. Changing or clearing the phone revokes it —
  // otherwise a member could consent on one number, swap in another, and we would be texting a
  // number that never agreed to anything.
  const phoneChanged = phone !== profile.phone;
  let smsConsent = phoneChanged ? false : (profile.smsConsent ?? false);
  let smsConsentAt = phoneChanged ? null : (profile.smsConsentAt ?? null);

  if (body.smsConsent !== undefined) {
    if (typeof body.smsConsent !== "boolean") throw new ApiError(400, "smsConsent must be a boolean");
    if (body.smsConsent && !phone) throw new ApiError(400, "Add a mobile number before turning on text reminders");
    // Only stamp a new timestamp on the transition into consent, so the audit trail records when
    // the member actually agreed rather than the last time they saved the form.
    if (body.smsConsent && !smsConsent) smsConsentAt = new Date().toISOString();
    if (!body.smsConsent) smsConsentAt = null;
    smsConsent = body.smsConsent;
  }

  const updated: Profile = {
    ...profile,
    name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : profile.name,
    phone,
    smsConsent,
    smsConsentAt,
    emailOptIn: typeof body.emailOptIn === "boolean" ? body.emailOptIn : (profile.emailOptIn ?? true),
  };
  await putProfile(updated);
  return updated;
}

export async function inviteUser(
  caller: Caller,
  body: { email?: unknown; name?: unknown; phone?: unknown; role?: unknown }
): Promise<Profile> {
  if (!caller.isAdmin) throw new ApiError(403, "Only an admin can invite users");
  if (typeof body.email !== "string" || !body.email.includes("@")) throw new ApiError(400, "A valid email is required");
  if (typeof body.name !== "string" || !body.name.trim()) throw new ApiError(400, "name is required");
  const role = body.role === "admin" ? "admin" : "member";
  const phone = validatePhone(body.phone);

  const email = body.email.trim().toLowerCase();
  const res = await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      UserAttributes: [
        { Name: "email", Value: email },
        { Name: "email_verified", Value: "true" },
        { Name: "name", Value: body.name.trim() },
      ],
      DesiredDeliveryMediums: ["EMAIL"],
    })
  );
  const sub = res.User?.Attributes?.find((a) => a.Name === "sub")?.Value;
  if (!sub) throw new ApiError(500, "Cognito did not return a user id");

  if (role === "admin") {
    await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: USER_POOL_ID, Username: email, GroupName: "admin" }));
  }

  // An admin can record a member's number but cannot consent on their behalf — the member has to
  // check the box themselves on the profile page before any SMS goes out.
  const profile: Profile = {
    id: sub,
    name: body.name.trim(),
    email,
    phone,
    role,
    smsConsent: false,
    smsConsentAt: null,
    emailOptIn: true,
  };
  await putProfile(profile);
  return profile;
}

export async function updateUser(
  caller: Caller,
  id: string,
  body: { name?: unknown; phone?: unknown; role?: unknown }
): Promise<Profile> {
  if (!caller.isAdmin) throw new ApiError(403, "Only an admin can edit users");
  const profile = await getProfile(id);
  if (!profile) throw new ApiError(404, "User not found");
  const newRole = body.role === undefined ? profile.role : body.role === "admin" ? "admin" : "member";
  if (newRole !== profile.role) {
    const cmd = newRole === "admin" ? AdminAddUserToGroupCommand : AdminRemoveUserFromGroupCommand;
    await cognito.send(new cmd({ UserPoolId: USER_POOL_ID, Username: profile.email, GroupName: "admin" }));
  }
  const phone = body.phone !== undefined ? validatePhone(body.phone) : profile.phone;
  // Same rule as updateMe, and there is deliberately no path here for an admin to *grant*
  // consent — only the member can do that, and editing their number revokes what they gave.
  const phoneChanged = phone !== profile.phone;

  const updated: Profile = {
    ...profile,
    name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : profile.name,
    phone,
    smsConsent: phoneChanged ? false : (profile.smsConsent ?? false),
    smsConsentAt: phoneChanged ? null : (profile.smsConsentAt ?? null),
    role: newRole,
  };
  await putProfile(updated);
  return updated;
}

export async function removeUser(caller: Caller, id: string): Promise<void> {
  if (!caller.isAdmin) throw new ApiError(403, "Only an admin can remove users");
  if (id === caller.sub) throw new ApiError(400, "You cannot remove yourself");
  const profile = await getProfile(id);
  if (!profile) throw new ApiError(404, "User not found");
  try {
    await cognito.send(new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: profile.email }));
  } catch (err) {
    if ((err as Error).name !== "UserNotFoundException") throw err;
  }
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { PK: `USER#${id}`, SK: "PROFILE" } }));
}
