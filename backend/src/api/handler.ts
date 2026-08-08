import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";
import { ApiError, getCaller, json, parseBody, type Caller } from "../lib/http.js";
import * as reservations from "./routes/reservations.js";
import * as supplies from "./routes/supplies.js";
import * as projects from "./routes/projects.js";
import * as chores from "./routes/chores.js";
import * as users from "./routes/users.js";
import * as settings from "./routes/settings.js";
import * as albums from "./routes/albums.js";
import * as media from "./routes/media.js";
import { getDashboard } from "./routes/dashboard.js";
import { listNotifications } from "./routes/notifications.js";

type Params = Record<string, string>;
type RouteHandler = (caller: Caller, params: Params, event: APIGatewayProxyEventV2WithJWTAuthorizer) => Promise<unknown>;

const routes: Array<[string, string, RouteHandler]> = [
  ["GET", "/me", (c) => users.ensureProfile(c)],
  ["PUT", "/me", (c, _p, e) => users.updateMe(c, parseBody(e))],

  ["GET", "/users", () => users.listProfiles()],
  ["POST", "/users", (c, _p, e) => users.inviteUser(c, parseBody(e))],
  ["PUT", "/users/:id", (c, p, e) => users.updateUser(c, p.id, parseBody(e))],
  ["DELETE", "/users/:id", (c, p) => users.removeUser(c, p.id)],

  ["GET", "/reservations", () => reservations.listReservations()],
  ["POST", "/reservations", (c, _p, e) => reservations.createReservation(c, parseBody(e))],
  ["PUT", "/reservations/:id", (c, p, e) => reservations.updateReservation(c, p.id, parseBody(e))],
  ["DELETE", "/reservations/:id", (c, p) => reservations.cancelReservation(c, p.id)],

  ["GET", "/supplies", () => supplies.listSupplies()],
  ["POST", "/supplies", (c, _p, e) => supplies.createSupply(c, parseBody(e))],
  ["PUT", "/supplies/:id", (c, p, e) => supplies.updateSupply(c, p.id, parseBody(e))],
  ["DELETE", "/supplies/:id", (_c, p) => supplies.deleteSupply(p.id)],

  ["GET", "/projects", () => projects.listProjects()],
  ["POST", "/projects", (c, _p, e) => projects.createProject(c, parseBody(e))],
  ["PUT", "/projects/:id", (c, p, e) => projects.updateProject(c, p.id, parseBody(e))],
  ["DELETE", "/projects/:id", (c, p) => projects.deleteProject(c, p.id)],
  ["POST", "/projects/:id/contributions", (c, p, e) => projects.addContribution(c, p.id, parseBody(e))],

  ["GET", "/chores", () => chores.listChores()],
  ["POST", "/chores", (c, _p, e) => chores.logChore(c, parseBody(e))],

  // Photo gallery (PRD 5.8) + print queue (PRD 5.9)
  ["GET", "/albums", () => albums.listAlbums()],
  ["POST", "/albums", (c, _p, e) => albums.createAlbum(c, parseBody(e))],
  ["GET", "/albums/:id", (_c, p) => albums.getAlbumWithMedia(p.id)],
  ["PUT", "/albums/:id", (c, p, e) => albums.updateAlbum(c, p.id, parseBody(e))],
  ["DELETE", "/albums/:id", (c, p) => albums.deleteAlbum(c, p.id)],
  ["POST", "/albums/:id/media", (c, p, e) => media.requestUpload(c, p.id, parseBody(e))],
  ["PUT", "/media/:albumId/:id", (c, p, e) => media.updateMediaItem(c, p.albumId, p.id, parseBody(e))],
  ["DELETE", "/media/:albumId/:id", (c, p) => media.deleteMediaItem(c, p.albumId, p.id)],
  ["POST", "/media/:albumId/:id/print-request", (c, p) => media.requestPrint(c, p.albumId, p.id)],
  ["DELETE", "/media/:albumId/:id/print-request", (c, p) => media.cancelPrintRequest(c, p.albumId, p.id)],
  ["POST", "/media/:albumId/:id/printed", (c, p) => media.markPrinted(c, p.albumId, p.id)],
  ["GET", "/print-queue", () => media.getPrintQueue()],
  ["POST", "/media-session", () => media.createMediaSession()],

  ["GET", "/settings", () => settings.getSettings()],
  ["PUT", "/settings", (c, _p, e) => settings.updateSettings(c, parseBody(e))],

  ["GET", "/dashboard", () => getDashboard()],
  ["GET", "/notifications", (c) => listNotifications(c)],
];

function match(pattern: string, path: string): Params | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params: Params = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(":")) {
      params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext.http.method;
  const path = event.rawPath.replace(/^\/api/, "");

  try {
    const caller = getCaller(event);
    for (const [routeMethod, pattern, routeHandler] of routes) {
      if (routeMethod !== method) continue;
      const params = match(pattern, path);
      if (!params) continue;
      const result = await routeHandler(caller, params, event);
      return json(method === "POST" ? 201 : 200, result ?? { ok: true });
    }
    return json(404, { error: `No route for ${method} ${path}` });
  } catch (err) {
    if (err instanceof ApiError) return json(err.statusCode, { error: err.message });
    console.error("Unhandled error:", err);
    return json(500, { error: "Internal server error" });
  }
}
