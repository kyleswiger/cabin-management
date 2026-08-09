import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { Dashboard } from "../types";
import { branding } from "../branding";
import { mediaApi } from "../media";

function fmt(dateISO: string): string {
  return new Date(dateISO + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get<Dashboard>("/dashboard").then(setData).catch((e) => setError((e as Error).message));
  }, []);

  // Pending print-queue count (PRD 5.7/5.9) — best-effort, tile only renders when > 0.
  const [printPending, setPrintPending] = useState(0);
  useEffect(() => {
    mediaApi.getPrintQueue().then((q) => setPrintPending(q.requested.length)).catch(() => {});
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <p className="muted">Loading…</p>;

  const mowOverdue = data.daysSinceLastMow === null || data.daysSinceLastMow > data.settings.vacancyThresholdDays;

  return (
    <>
      <h1>Dashboard</h1>
      <div className="cards">
        <div className="card">
          <h2>Right now</h2>
          {data.current ? (
            <>
              <p className="big">🧑‍🤝‍🧑 {data.current.createdByName} is at the {branding.propertyNoun}</p>
              <p className="muted">
                {fmt(data.current.startDate)} → {fmt(data.current.endDate)}
                {data.current.attendees && <> · {data.current.attendees}</>}
              </p>
            </>
          ) : (
            <>
              <p className="big">🌲 No one is at the {branding.propertyNoun}</p>
              {data.lastCheckout && <p className="muted">Last checkout {fmt(data.lastCheckout)}</p>}
            </>
          )}
        </div>

        <div className="card">
          <h2>Next visit</h2>
          {data.next ? (
            <>
              <p className="big">{fmt(data.next.startDate)}</p>
              <p className="muted">
                {data.next.createdByName}
                {data.next.attendees && <> · {data.next.attendees}</>} · through {fmt(data.next.endDate)}
              </p>
              {data.vacancyGapDays !== null && data.vacancyGapDays > data.settings.vacancyThresholdDays && (
                <p className="muted">⚠️ {data.vacancyGapDays}-day vacancy gap before this visit</p>
              )}
            </>
          ) : (
            <p className="big">Nothing scheduled</p>
          )}
          <Link to="/calendar" className="muted">Open calendar →</Link>
        </div>

        <div className="card">
          <h2>Yard</h2>
          {data.lastMow ? (
            <p className="big">
              {mowOverdue ? "🚜 Mow needed" : "✅ Yard is fine"}
            </p>
          ) : (
            <p className="big">🚜 No mow on record</p>
          )}
          <p className="muted">
            {data.lastMow
              ? `Last mowed ${fmt(data.lastMow.completedDate)} by ${data.lastMow.completedByName} (${data.daysSinceLastMow} days ago)`
              : "Log the first mow on the Yardwork page"}
            {data.lastTrim && <> · last trim {fmt(data.lastTrim.completedDate)}</>}
          </p>
          <Link to="/yardwork" className="muted">Log yardwork →</Link>
        </div>

        <div className="card">
          <h2>Supplies to grab</h2>
          {data.lowOutSupplies.length === 0 ? (
            <p className="big">✅ Fully stocked</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
              {data.lowOutSupplies.map((s) => (
                <li key={s.id}>
                  {s.name} <span className={`chip ${s.status}`}>{s.status}</span>
                </li>
              ))}
            </ul>
          )}
          <Link to="/supplies" className="muted">Supply checklist →</Link>
        </div>

        {data.latestGuestbookEntry && (
          <div className="card">
            <h2>Guestbook</h2>
            <p className="big">📖 {data.latestGuestbookEntry.title}</p>
            <p className="muted">
              {data.latestGuestbookEntry.authorName} · {fmt(data.latestGuestbookEntry.visitStart)}
            </p>
            <Link to="/guestbook" className="muted">Read the guestbook →</Link>
          </div>
        )}

        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <h2>Open projects ({data.openProjects.length})</h2>
          {data.openProjects.length === 0 ? (
            <p className="muted">Backlog is clear 🎉</p>
          ) : (
            <table className="list">
              <thead>
                <tr><th>Project</th><th>Priority</th><th>Status</th><th>Chipped in</th></tr>
              </thead>
              <tbody>
                {data.openProjects.map((p) => (
                  <tr key={p.id}>
                    <td>{p.title}</td>
                    <td><span className={`chip ${p.priority === "low" ? "low-priority" : p.priority}`}>{p.priority}</span></td>
                    <td><span className={`chip ${p.status}`}>{p.status.replace("_", " ")}</span></td>
                    <td>
                      ${p.contributedTotal.toFixed(0)}
                      {p.estimatedCost ? ` / $${p.estimatedCost.toFixed(0)}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p style={{ marginBottom: 0 }}><Link to="/projects" className="muted">Project tracker →</Link></p>
        </div>

        {printPending > 0 && (
          <div className="card">
            <h2>Print queue</h2>
            <p className="big">🖨️ {printPending} photo{printPending === 1 ? "" : "s"} waiting to print</p>
            <Link to="/prints" className="muted">Open print queue →</Link>
          </div>
        )}
      </div>
    </>
  );
}
