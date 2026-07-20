#!/usr/bin/env node
// Create (or repair) a user: Cognito account + DynamoDB profile + optional admin group.
// Cognito emails the temporary password to the user.
// Usage: USER_POOL_ID=... TABLE_NAME=... node scripts/create-user.mjs <email> "<Full Name>" [admin] [+1555...]
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminAddUserToGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const [email, name, roleArg, phone] = process.argv.slice(2);
const { USER_POOL_ID, TABLE_NAME } = process.env;
if (!email || !name || !USER_POOL_ID || !TABLE_NAME) {
  console.error('Usage: USER_POOL_ID=... TABLE_NAME=... node scripts/create-user.mjs <email> "<Full Name>" [admin] [+1555...]');
  process.exit(1);
}
const isAdmin = roleArg === "admin";

const cognito = new CognitoIdentityProviderClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });

let sub;
try {
  const res = await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      UserAttributes: [
        { Name: "email", Value: email },
        { Name: "email_verified", Value: "true" },
        { Name: "name", Value: name },
      ],
      DesiredDeliveryMediums: ["EMAIL"],
    })
  );
  sub = res.User.Attributes.find((a) => a.Name === "sub").Value;
  console.log(`Created Cognito user ${email} (${sub}); temporary password emailed.`);
} catch (err) {
  if (err.name === "UsernameExistsException") {
    const existing = await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: email }));
    sub = existing.UserAttributes.find((a) => a.Name === "sub").Value;
    console.log(`Cognito user ${email} already exists (${sub}); updating profile only.`);
  } else {
    throw err;
  }
}

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
      phone: phone ?? null,
      role: isAdmin ? "admin" : "member",
    },
  })
);
console.log("Profile written. Done.");
