import { randomUUID } from "node:crypto";
import { ddb, GetCommand, PutCommand, DeleteCommand, TABLE, queryType, getSettings } from "../../lib/db.js";
import { ApiError, type Caller } from "../../lib/http.js";
import { getProfile, listProfiles } from "../../lib/users.js";
import { sendSms } from "../../lib/sms.js";
import { APP_NAME } from "../../lib/branding.js";

export interface Project {
  id: string;
  title: string;
  description: string;
  status: "not_started" | "in_progress" | "done";
  priority: "high" | "medium" | "low";
  estimatedCost: number | null;
  createdAt: string;
}

export interface Contribution {
  id: string;
  projectId: string;
  userId: string;
  userName: string;
  amount: number;
  date: string;
  note: string;
}

const STATUSES = new Set(["not_started", "in_progress", "done"]);
const PRIORITIES = new Set(["high", "medium", "low"]);

export async function listProjects(): Promise<Array<Project & { contributions: Contribution[]; contributedTotal: number }>> {
  const [projects, contribs] = await Promise.all([queryType<Project>("PROJECT"), queryType<Contribution>("CONTRIB")]);
  const order = { high: 0, medium: 1, low: 2 };
  return projects
    .sort((a, b) => order[a.priority] - order[b.priority] || a.createdAt.localeCompare(b.createdAt))
    .map((p) => {
      const contributions = contribs.filter((c) => c.projectId === p.id).sort((a, b) => a.date.localeCompare(b.date));
      return { ...p, contributions, contributedTotal: contributions.reduce((sum, c) => sum + c.amount, 0) };
    });
}

async function save(p: Project): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: { PK: `PROJECT#${p.id}`, SK: "META", GSI1PK: "PROJECT", GSI1SK: p.createdAt, ...p },
    })
  );
}

interface ProjectInput {
  title?: unknown;
  description?: unknown;
  status?: unknown;
  priority?: unknown;
  estimatedCost?: unknown;
}

function parseCost(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new ApiError(400, "estimatedCost must be a non-negative number");
  return n;
}

export async function createProject(_caller: Caller, body: ProjectInput): Promise<Project> {
  if (typeof body.title !== "string" || !body.title.trim()) throw new ApiError(400, "title is required");
  const p: Project = {
    id: randomUUID(),
    title: body.title.trim(),
    description: typeof body.description === "string" ? body.description : "",
    status: typeof body.status === "string" && STATUSES.has(body.status) ? (body.status as Project["status"]) : "not_started",
    priority: typeof body.priority === "string" && PRIORITIES.has(body.priority) ? (body.priority as Project["priority"]) : "medium",
    estimatedCost: parseCost(body.estimatedCost),
    createdAt: new Date().toISOString(),
  };
  await save(p);
  return p;
}

export async function updateProject(caller: Caller, id: string, body: ProjectInput): Promise<Project> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: `PROJECT#${id}`, SK: "META" } }));
  if (!res.Item) throw new ApiError(404, "Project not found");
  const existing = res.Item as Project;
  if (body.status !== undefined && (typeof body.status !== "string" || !STATUSES.has(body.status))) {
    throw new ApiError(400, "status must be not_started, in_progress, or done");
  }
  if (body.priority !== undefined && (typeof body.priority !== "string" || !PRIORITIES.has(body.priority))) {
    throw new ApiError(400, "priority must be high, medium, or low");
  }
  const updated: Project = {
    ...existing,
    title: typeof body.title === "string" && body.title.trim() ? body.title.trim() : existing.title,
    description: typeof body.description === "string" ? body.description : existing.description,
    status: (body.status as Project["status"]) ?? existing.status,
    priority: (body.priority as Project["priority"]) ?? existing.priority,
    estimatedCost: body.estimatedCost !== undefined ? parseCost(body.estimatedCost) : existing.estimatedCost,
  };
  await save(updated);
  if (updated.status !== existing.status) {
    await notifyProjectUpdate(caller, `${APP_NAME}: "${updated.title}" is now ${updated.status.replace("_", " ")}.`);
  }
  return updated;
}

export async function deleteProject(caller: Caller, id: string): Promise<void> {
  if (!caller.isAdmin) throw new ApiError(403, "Only an admin can delete a project");
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { PK: `PROJECT#${id}`, SK: "META" } }));
}

export async function addContribution(
  caller: Caller,
  projectId: string,
  body: { amount?: unknown; date?: unknown; note?: unknown }
): Promise<Contribution> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: `PROJECT#${projectId}`, SK: "META" } }));
  if (!res.Item) throw new ApiError(404, "Project not found");
  const project = res.Item as Project;
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new ApiError(400, "amount must be a positive number");
  const profile = await getProfile(caller.sub);
  const c: Contribution = {
    id: randomUUID(),
    projectId,
    userId: caller.sub,
    userName: profile?.name ?? caller.name,
    amount,
    date: typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : new Date().toISOString().slice(0, 10),
    note: typeof body.note === "string" ? body.note : "",
  };
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: { PK: `PROJECT#${projectId}`, SK: `CONTRIB#${c.id}`, GSI1PK: "CONTRIB", GSI1SK: c.date, ...c },
    })
  );
  await notifyProjectUpdate(caller, `${APP_NAME}: ${c.userName} chipped in $${amount.toFixed(2)} toward "${project.title}".`);
  return c;
}

async function notifyProjectUpdate(actor: Caller, message: string): Promise<void> {
  const settings = await getSettings();
  if (!settings.notifyOnProjectUpdates) return;
  const profiles = await listProfiles();
  await Promise.all(
    profiles
      .filter((p) => p.id !== actor.sub && p.phone)
      .map((p) => sendSms({ userId: p.id, phone: p.phone, consent: p.smsConsent, type: "project_update", message }))
  );
}
