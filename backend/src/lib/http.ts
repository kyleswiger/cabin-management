import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";

export class ApiError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

export function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function parseBody<T = Record<string, unknown>>(event: APIGatewayProxyEventV2WithJWTAuthorizer): T {
  if (!event.body) throw new ApiError(400, "Request body required");
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
    return JSON.parse(raw) as T;
  } catch {
    throw new ApiError(400, "Invalid JSON body");
  }
}

export interface Caller {
  sub: string;
  email: string;
  name: string;
  isAdmin: boolean;
}

export function getCaller(event: APIGatewayProxyEventV2WithJWTAuthorizer): Caller {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const sub = String(claims.sub ?? "");
  if (!sub) throw new ApiError(401, "Unauthenticated");
  const groupsRaw = String(claims["cognito:groups"] ?? "");
  return {
    sub,
    email: String(claims.email ?? ""),
    name: String(claims.name ?? claims.email ?? ""),
    isAdmin: groupsRaw.includes("admin"),
  };
}

/** YYYY-MM-DD validation */
export function assertDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || isNaN(Date.parse(value))) {
    throw new ApiError(400, `${field} must be a YYYY-MM-DD date`);
  }
  return value;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((Date.parse(toISO) - Date.parse(fromISO)) / 86_400_000);
}
