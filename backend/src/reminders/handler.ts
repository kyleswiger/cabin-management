import { getSettings, queryType } from "../lib/db.js";
import { daysBetween, todayISO } from "../lib/http.js";
import { sendSms } from "../lib/sms.js";
import type { Reservation } from "../api/routes/reservations.js";
import type { SupplyItem } from "../api/routes/supplies.js";
import type { ChoreLog } from "../api/routes/chores.js";
import type { Profile } from "../lib/users.js";
import { APP_NAME } from "../lib/branding.js";

/**
 * Daily reminder evaluation (PRD 5.3 / 5.6). Runs on an EventBridge schedule so
 * reminders fire even when nobody opens the site.
 */
export async function handler(): Promise<{ sent: number }> {
  const today = todayISO();
  const [settings, allReservations, supplies, chores, profiles] = await Promise.all([
    getSettings(),
    queryType<Reservation>("RESERVATION"),
    queryType<SupplyItem>("SUPPLY"),
    queryType<ChoreLog>("CHORE"),
    queryType<Profile>("USER"),
  ]);

  const reservations = allReservations
    .filter((r) => r.status === "active")
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const lowOut = supplies.filter((s) => s.status !== "ok");
  const mowDates = chores.filter((c) => c.type === "mow").map((c) => c.completedDate).sort();
  const lastMow = mowDates[mowDates.length - 1] ?? null;
  const daysSinceMowAt = (date: string) => (lastMow ? daysBetween(lastMow, date) : Infinity);

  let sent = 0;
  const notify = async (userId: string, type: string, message: string) => {
    await sendSms({ userId, phone: profileById.get(userId)?.phone, type, message });
    sent++;
  };

  // 1. Pre-visit reminder: supplies to grab + heads-up if the yard will be overgrown on arrival.
  for (const r of reservations.filter((r) => daysBetween(today, r.startDate) === settings.preVisitReminderDays)) {
    const lines = [`${APP_NAME}: your visit starts ${r.startDate}.`];
    if (lowOut.length > 0) {
      lines.push(`Grab on your way up: ${lowOut.map((s) => `${s.name} (${s.status})`).join(", ")}.`);
    }
    if (daysSinceMowAt(r.startDate) > settings.vacancyThresholdDays) {
      lines.push(
        lastMow
          ? `Yard heads-up: last mow was ${lastMow} — plan to mow/trim during your stay.`
          : "Yard heads-up: no mow on record — plan to mow/trim during your stay."
      );
    }
    await notify(r.createdBy, "pre_visit", lines.join(" "));
  }

  // 2. Checkout reminder: long vacancy ahead → mow before leaving.
  for (const r of reservations.filter((r) => r.endDate === today)) {
    const next = reservations.find((n) => n.id !== r.id && n.startDate >= today);
    const gap = next ? daysBetween(today, next.startDate) : Infinity;
    if (gap > settings.vacancyThresholdDays) {
      const gapText = next ? `${gap} days until the next visit (${next.startDate})` : "no upcoming visits on the calendar";
      await notify(
        r.createdBy,
        "checkout_mow",
        `${APP_NAME}: before you head out — ${gapText}, so please mow and trim today and log it on the site.`
      );
    }
  }

  // 3. Arrival-day backstop: it's been too long since the last cut.
  for (const r of reservations.filter((r) => r.startDate === today)) {
    if (daysSinceMowAt(today) > settings.vacancyThresholdDays) {
      await notify(
        r.createdBy,
        "arrival_mow",
        lastMow
          ? `${APP_NAME}: welcome up! Last mow was ${lastMow} (${daysSinceMowAt(today)} days ago) — the yard likely needs mowing/trimming.`
          : `${APP_NAME}: welcome up! No mow is on record — the yard likely needs mowing/trimming.`
      );
    }
  }

  console.log(`Reminder run complete for ${today}: ${sent} notification(s).`);
  return { sent };
}
