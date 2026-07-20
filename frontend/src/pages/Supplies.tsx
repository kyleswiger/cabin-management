import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import type { SupplyItem } from "../types";

const STATUSES: SupplyItem["status"][] = ["ok", "low", "out"];

export default function SuppliesPage() {
  const [items, setItems] = useState<SupplyItem[]>([]);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => api.get<SupplyItem[]>("/supplies").then(setItems).catch((e) => setError((e as Error).message)), []);
  useEffect(() => {
    void load();
  }, [load]);

  const setStatus = async (item: SupplyItem, status: SupplyItem["status"]) => {
    try {
      await api.put(`/supplies/${item.id}`, { status });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      await api.post("/supplies", { name: newName.trim() });
      setNewName("");
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async (item: SupplyItem) => {
    if (!window.confirm(`Remove "${item.name}" from the checklist?`)) return;
    try {
      await api.del(`/supplies/${item.id}`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const needed = items.filter((i) => i.status !== "ok");

  return (
    <>
      <h1>Supply checklist</h1>
      <p className="muted">
        Notice something running low during your stay? Mark it here — whoever heads up next gets it in their reminder text.
      </p>
      {error && <div className="error">{error}</div>}
      {needed.length > 0 && (
        <div className="notice">🛒 Grab on the way up: {needed.map((i) => i.name).join(", ")}</div>
      )}

      <div className="card">
        {items.map((item) => (
          <div className="item-row" key={item.id}>
            <div className="grow">
              <strong>{item.name}</strong>
              <div className="muted">
                Updated {new Date(item.lastUpdatedDate).toLocaleDateString()} by {item.lastUpdatedBy}
              </div>
            </div>
            {STATUSES.map((s) => (
              <button
                key={s}
                className={`btn small ${item.status === s ? "" : "secondary"}`}
                style={item.status === s ? { background: s === "ok" ? "#3f7d4e" : s === "low" ? "#b07d2a" : "#a03c2e" } : {}}
                onClick={() => void setStatus(item, s)}
              >
                {s}
              </button>
            ))}
            <button className="btn danger small" onClick={() => void remove(item)}>✕</button>
          </div>
        ))}
        <form onSubmit={add} style={{ display: "flex", gap: "0.6rem", marginTop: "1rem" }}>
          <input value={newName} placeholder="Add an item (e.g. bug spray)" onChange={(e) => setNewName(e.target.value)} />
          <button className="btn" style={{ whiteSpace: "nowrap" }}>Add item</button>
        </form>
      </div>
    </>
  );
}
