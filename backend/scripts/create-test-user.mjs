#!/usr/bin/env node
// Provision (or repair) a dedicated end-to-end test account for the Playwright suite.
//
// Unlike create-user.mjs, this sets a *permanent* password directly (no email round-trip,
// no forced "new password" challenge on first login) so an automated browser can sign in
// with a known credential. Intended only for a clearly-marked test user.
//
// Usage:
//   USER_POOL_ID=... TABLE_NAME=... \
//   TEST_USER_EMAIL=playwright-e2e@example.com \
//   TEST_USER_PASSWORD='a-strong-password' \
//   TEST_USER_NAME='Playwright E2E' \
//   node scripts/create-test-user.mjs [admin]
//
// Idempotent: re-running resets the password and profile for an existing account.
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  AdminAddUserToGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const roleArg = process.argv[2];
const isAdmin = roleArg === "admin";
const { USER_POOL_ID, TABLE_NAME, TEST_USER_EMAIL, TEST_USER_PASSWORD } = process.env;
const name = process.env.TEST_USER_NAME || "Playwright E2E";
const email = TEST_USER_EMAIL?.trim().toLowerCase();

if (!USER_POOL_ID || !TABLE_NAME || !email || !TEST_USER_PASSWORD) {
  console.error(
    "Usage: USER_POOL_ID=... TABLE_NAME=... TEST_USER_EMAIL=... TEST_USER_PASSWORD=... " +
      '[TEST_USER_NAME="..."] node scripts/create-test-user.mjs [admin]'
  );
  process.exit(1);
}

const cognito = new CognitoIdentityProviderClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });

let sub;
try {
  const res = await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      MessageAction: "SUPPRESS", // no invite email — this is a machine account
      UserAttributes: [
        { Name: "email", Value: email },
        { Name: "email_verified", Value: "true" },
        { Name: "name", Value: name },
      ],
    })
  );
  sub = res.User.Attributes.find((a) => a.Name === "sub").Value;
  console.log(`Created Cognito test user ${email} (${sub}).`);
} catch (err) {
  if (err.name === "UsernameExistsException") {
    const existing = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: email }));
    sub = existing.UserAttributes.find((a) => a.Name === "sub").Value;
    console.log(`Cognito test user ${email} already exists (${sub}); resetting password.`);
  } else {
    throw err;
  }
}

await cognito.send(
  new AdminSetUserPasswordCommand({
    UserPoolId: USER_POOL_ID,
    Username: email,
    Password: TEST_USER_PASSWORD,
    Permanent: true,
  })
);
console.log("Set permanent password (no first-login challenge).");

if (isAdmin) {
  await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: USER_POOL_ID, Username: email, GroupName: "admin" }));
  console.log("Added to admin group.");
}

await ddb.send(
  new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: `USER#${sub}`,
      SK: "PROFILE",
      GSI1PK: "USER",
      GSI1SK: name.toLowerCase(),
      id: sub,
      name,
      email,
      phone: null,
      role: isAdmin ? "admin" : "member",
    },
  })
);
console.log("Profile written. Test account ready.");
