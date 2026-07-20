import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserPool,
  type CognitoUserSession,
} from "amazon-cognito-identity-js";
import { USER_POOL_ID, CLIENT_ID } from "./config";

const pool = new CognitoUserPool({ UserPoolId: USER_POOL_ID, ClientId: CLIENT_ID });

export type LoginResult =
  | { kind: "ok" }
  | { kind: "new-password-required"; complete: (newPassword: string) => Promise<void> };

export function login(email: string, password: string): Promise<LoginResult> {
  const user = new CognitoUser({ Username: email, Pool: pool });
  const details = new AuthenticationDetails({ Username: email, Password: password });
  return new Promise((resolve, reject) => {
    user.authenticateUser(details, {
      onSuccess: () => resolve({ kind: "ok" }),
      onFailure: (err) => reject(err),
      newPasswordRequired: () => {
        resolve({
          kind: "new-password-required",
          complete: (newPassword: string) =>
            new Promise<void>((res, rej) => {
              user.completeNewPasswordChallenge(newPassword, {}, {
                onSuccess: () => res(),
                onFailure: (err) => rej(err),
              });
            }),
        });
      },
    });
  });
}

export function logout(): void {
  pool.getCurrentUser()?.signOut();
}

/** Current valid session, refreshing via refresh token if needed. Null when signed out/expired. */
export function getSession(): Promise<CognitoUserSession | null> {
  const user = pool.getCurrentUser();
  if (!user) return Promise.resolve(null);
  return new Promise((resolve) => {
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) resolve(null);
      else resolve(session);
    });
  });
}

export async function getIdToken(): Promise<string | null> {
  const session = await getSession();
  return session?.getIdToken().getJwtToken() ?? null;
}

export function requestPasswordReset(email: string): Promise<void> {
  const user = new CognitoUser({ Username: email, Pool: pool });
  return new Promise((resolve, reject) => {
    user.forgotPassword({ onSuccess: () => resolve(), onFailure: (err) => reject(err) });
  });
}

export function confirmPasswordReset(email: string, code: string, newPassword: string): Promise<void> {
  const user = new CognitoUser({ Username: email, Pool: pool });
  return new Promise((resolve, reject) => {
    user.confirmPassword(code, newPassword, { onSuccess: () => resolve(), onFailure: (err) => reject(err) });
  });
}
