import { getSettings, queryType } from "../lib/db.js";
import { daysBetween, todayISO } from "../lib/http.js";
import { sendSms } from "../lib/sms.js";
import { sendEmail } from "../lib/email.js";
import type { Reservation } from "../api/routes/reservations.js";
import type { SupplyItem } from "../api/routes/supplies.js";
import type { ChoreLog } from "../api/routes/chores.js";
import type { Profile } from "../lib/users.js";
import type { GuestbookEntry } from "../api/routes/guestbook.js";
import { APP_NAME, PROPERTY_NOUN } from "../lib/branding.js";

/**
 * Subject lines per reminder type. SMS carries the whole message in one line; email needs a
 * subject, and a generic one ("You have a notification") is what makes people stop opening them.
 */
const EMAIL_SUBJECTS: Record<string, string> = {
  pre_visit: `${APP_NAME}: your visit is coming up`,
  checkout_mow: `${APP_NAME}: before you head out`,
  arrival_mow: `${APP_NAME}: the yard needs attention`,
};

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
  /**
   * Fan one reminder out to both channels. They are independent on purpose: neither throws, and a
   * member with SMS consent and email opt-in gets both, while a member with neither still gets a
   * NOTIF row per channel explaining why nothing went out. `sent` counts reminders evaluated, not
   * messages delivered — the notification log is the record of what actually happened.
   */
  const notify = async (userId: string, type: string, message: string) => {
    const profile = profileById.get(userId);
    await Promise.all([
      sendSms({ userId, phone: profile?.phone, consent: profile?.smsConsent, type, message }),
      sendEmail({
        userId,
        email: profile?.email,
        optedIn: profile?.emailOptIn ?? true,
        type,
        subject: EMAIL_SUBJECTS[type] ?? `${APP_NAME} reminder`,
        message,
      }),
    ]);
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

  // 4. Post-checkout guestbook nudge (PRD 5.10): the day after checkout, ask the visit's
  // creator to write an entry — unless they already wrote one covering that visit. SMS only,
  // and admin-toggleable via `guestbookNudgeEnabled` (off by default).
  if (settings.guestbookNudgeEnabled) {
    const entries = await queryType<GuestbookEntry>("GUESTBOOK");
    for (const r of reservations.filter((r) => daysBetween(r.endDate, today) === 1)) {
      // "Already wrote one" = an entry by the same author whose inclusive visit range overlaps
      // this reservation. Same-day turnover is legal, so an entry that merely *ends* on this
      // reservation's arrival date describes the previous trip and must not suppress this
      // nudge — it counts only if it extends past arrival or starts on/after it.
      const alreadyWrote = entries.some(
        (e) =>
          e.author === r.createdBy &&
          e.visitStart <= r.endDate &&
          (e.visitEnd > r.startDate || e.visitStart >= r.startDate)
      );
      if (alreadyWrote) continue;
      const profile = profileById.get(r.createdBy);
      await sendSms({
        userId: r.createdBy,
        phone: profile?.phone,
        consent: profile?.smsConsent,
        type: "guestbook_nudge",
        message: `${APP_NAME}: hope you had a great stay! Take a minute to add a guestbook entry about your trip — the ${PROPERTY_NOUN} logbook is how we all relive it.`,
      });
      sent++;
    }
  }

  console.log(`Reminder run complete for ${today}: ${sent} notification(s).`);
  return { sent };
}
