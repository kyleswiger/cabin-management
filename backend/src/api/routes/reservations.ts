import { randomUUID } from "node:crypto";
import { ddb, GetCommand, PutCommand, TABLE, queryType, getSettings } from "../../lib/db.js";
import { ApiError, assertDate, daysBetween, todayISO, type Caller } from "../../lib/http.js";
import { getProfile } from "../../lib/users.js";
import { sendSms } from "../../lib/sms.js";
import { APP_NAME, PRIORITY_USER_LABEL_POSSESSIVE, PROPERTY_NOUN } from "../../lib/branding.js";

export interface Reservation {
  id: string;
  startDate: string;
  endDate: string;
  createdBy: string;
  createdByName: string;
  attendees: string;
  notes: string;
  status: "active" | "cancelled";
  createdAt: string;
}

export async function listReservations(): Promise<Reservation[]> {
  const all = await queryType<Reservation>("RESERVATION");
  return all.filter((r) => r.status === "active").sort((a, b) => a.startDate.localeCompare(b.startDate));
}

async function getReservation(id: string): Promise<Reservation> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: `RES#${id}`, SK: "META" } }));
  if (!res.Item || (res.Item as Reservation).status !== "active") throw new ApiError(404, "Reservation not found");
  return res.Item as Reservation;
}

async function save(r: Reservation): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: { PK: `RES#${r.id}`, SK: "META", GSI1PK: "RESERVATION", GSI1SK: r.startDate, ...r },
    })
  );
}

/** Half-open interval overlap: same-day turnover (one ends the day another starts) is allowed. */
function findConflict(all: Reservation[], startDate: string, endDate: string, excludeId?: string): Reservation | undefined {
  return all.find(
    (r) => r.status === "active" && r.id !== excludeId && startDate < r.endDate && r.startDate < endDate
  );
}

async function validateDatesAndRules(
  caller: Caller,
  startDate: string,
  endDate: string,
  excludeId?: string
): Promise<void> {
  if (endDate <= startDate) throw new ApiError(400, "endDate must be after startDate");
  if (startDate < todayISO()) throw new ApiError(400, "Reservations cannot start in the past");

  const all = await queryType<Reservation>("RESERVATION");
  const conflict = findConflict(all, startDate, endDate, excludeId);
  if (conflict) {
    throw new ApiError(409, `Those dates overlap ${conflict.createdByName}'s reservation (${conflict.startDate} to ${conflict.endDate})`);
  }

  const settings = await getSettings();
  if (settings.priorityUserId && caller.sub !== settings.priorityUserId) {
    const daysUntilStart = daysBetween(todayISO(), startDate);
    if (daysUntilStart > settings.priorityWindowDays) {
      const opensOn = new Date(Date.parse(startDate) - settings.priorityWindowDays * 86_400_000).toISOString().slice(0, 10);
      throw new ApiError(
        409,
        `Those dates are still in ${PRIORITY_USER_LABEL_POSSESSIVE} first-look window. They open to everyone on ${opensOn} (${settings.priorityWindowDays} days before arrival) unless they are claimed first.`
      );
    }
  }
}

interface ReservationInput {
  startDate?: unknown;
  endDate?: unknown;
  attendees?: unknown;
  notes?: unknown;
}

export async function createReservation(caller: Caller, body: ReservationInput): Promise<Reservation> {
  const startDate = assertDate(body.startDate, "startDate");
  const endDate = assertDate(body.endDate, "endDate");
  await validateDatesAndRules(caller, startDate, endDate);
  const profile = await getProfile(caller.sub);
  const r: Reservation = {
    id: randomUUID(),
    startDate,
    endDate,
    createdBy: caller.sub,
    createdByName: profile?.name ?? caller.name,
    attendees: typeof body.attendees === "string" ? body.attendees : "",
    notes: typeof body.notes === "string" ? body.notes : "",
    status: "active",
    createdAt: new Date().toISOString(),
  };
  await save(r);
  return r;
}

export async function updateReservation(caller: Caller, id: string, body: ReservationInput): Promise<Reservation> {
  const existing = await getReservation(id);
  if (existing.createdBy !== caller.sub && !caller.isAdmin) throw new ApiError(403, "Only the creator or an admin can edit a reservation");
  const startDate = body.startDate !== undefined ? assertDate(body.startDate, "startDate") : existing.startDate;
  const endDate = body.endDate !== undefined ? assertDate(body.endDate, "endDate") : existing.endDate;
  if (startDate !== existing.startDate || endDate !== existing.endDate) {
    await validateDatesAndRules(caller, startDate, endDate, id);
  }
  const updated: Reservation = {
    ...existing,
    startDate,
    endDate,
    attendees: typeof body.attendees === "string" ? body.attendees : existing.attendees,
    notes: typeof body.notes === "string" ? body.notes : existing.notes,
  };
  await save(updated);
  if (startDate !== existing.startDate || endDate !== existing.endDate) {
    await notifyVacancyChange(existing);
  }
  return updated;
}

export async function cancelReservation(caller: Caller, id: string): Promise<void> {
  const existing = await getReservation(id);
  if (existing.createdBy !== caller.sub && !caller.isAdmin) throw new ApiError(403, "Only the creator or an admin can cancel a reservation");
  await save({ ...existing, status: "cancelled" });
  await notifyVacancyChange(existing);
}

/**
 * After a reservation is cancelled or moved, tell the next upcoming visitor if the
 * vacancy gap before their stay now exceeds the yardwork threshold (PRD 5.2).
 */
async function notifyVacancyChange(changed: Reservation): Promise<void> {
  const settings = await getSettings();
  const today = todayISO();
  const active = (await queryType<Reservation>("RESERVATION")).filter((r) => r.status === "active");
  const next = active
    .filter((r) => r.startDate >= changed.startDate && r.startDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  if (!next || next.createdBy === changed.createdBy) return;
  const priorCheckouts = active.filter((r) => r.endDate <= next.startDate).map((r) => r.endDate).sort();
  const lastCheckout = priorCheckouts[priorCheckouts.length - 1] ?? null;
  const gap = lastCheckout ? daysBetween(lastCheckout, next.startDate) : Infinity;
  if (gap <= settings.vacancyThresholdDays) return;
  const profile = await getProfile(next.createdBy);
  await sendSms({
    userId: next.createdBy,
    phone: profile?.phone,
    consent: profile?.smsConsent,
    type: "vacancy_change",
    message: `${APP_NAME}: a reservation change means the ${PROPERTY_NOUN} will now sit empty for ${
      gap === Infinity ? "a long stretch" : `${gap} days`
    } before your ${next.startDate} visit. The yard may need mowing/trimming when you arrive.`,
  });
}
