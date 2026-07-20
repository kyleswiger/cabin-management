import { getSettings } from "../../lib/db.js";
import { daysBetween, todayISO } from "../../lib/http.js";
import { listReservations } from "./reservations.js";
import { listSupplies } from "./supplies.js";
import { listProjects } from "./projects.js";
import { listChores } from "./chores.js";

export async function getDashboard() {
  const today = todayISO();
  const [reservations, supplies, projects, chores, settings] = await Promise.all([
    listReservations(),
    listSupplies(),
    listProjects(),
    listChores(),
    getSettings(),
  ]);

  const current = reservations.find((r) => r.startDate <= today && today < r.endDate) ?? null;
  const next = reservations.find((r) => r.startDate > today) ?? null;
  const pastCheckouts = reservations.filter((r) => r.endDate <= today).map((r) => r.endDate).sort();
  const lastCheckout = pastCheckouts[pastCheckouts.length - 1] ?? null;

  const lastMow = chores.find((c) => c.type === "mow") ?? null;
  const lastTrim = chores.find((c) => c.type === "trim") ?? null;

  return {
    today,
    current,
    next,
    lastCheckout,
    vacancyGapDays: !current && next && lastCheckout ? daysBetween(lastCheckout, next.startDate) : null,
    daysSinceLastMow: lastMow ? daysBetween(lastMow.completedDate, today) : null,
    lastMow,
    lastTrim,
    lowOutSupplies: supplies.filter((s) => s.status !== "ok"),
    openProjects: projects.filter((p) => p.status !== "done"),
    settings,
  };
}
