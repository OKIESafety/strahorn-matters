"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveScheduleAction, type ScheduleInput } from "../actions";

type T = { day: number; time: string; to: "a" | "b" };

const PRESETS: { label: string; hint: string; days: number; t: T[] }[] = [
  {
    label: "Week on / week off",
    hint: "Start on the day the first week begins",
    days: 14,
    t: [
      { day: 0, time: "18:00", to: "a" },
      { day: 7, time: "18:00", to: "b" },
    ],
  },
  {
    label: "2-2-3",
    hint: "Start on a Monday",
    days: 14,
    t: [
      { day: 0, time: "18:00", to: "a" },
      { day: 2, time: "18:00", to: "b" },
      { day: 4, time: "18:00", to: "a" },
      { day: 7, time: "18:00", to: "b" },
      { day: 9, time: "18:00", to: "a" },
      { day: 11, time: "18:00", to: "b" },
    ],
  },
  {
    label: "Alternating weekends",
    hint: "Start on a Friday when you have the weekend",
    days: 14,
    t: [
      { day: 0, time: "18:00", to: "a" },
      { day: 2, time: "18:00", to: "b" },
    ],
  },
  {
    label: "Alternating weekends + Wednesday evenings",
    hint: "Start on a Friday when you have the weekend",
    days: 14,
    t: [
      { day: 0, time: "18:00", to: "a" },
      { day: 2, time: "18:00", to: "b" },
      { day: 5, time: "17:00", to: "a" },
      { day: 5, time: "20:00", to: "b" },
      { day: 12, time: "17:00", to: "a" },
      { day: 12, time: "20:00", to: "b" },
    ],
  },
];

function weekdayLabel(start: string, offset: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return `Day ${offset + 1}`;
  const [y, m, d] = start.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + offset, 12));
  return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

export function ScheduleEditor({
  matterId,
  parents,
  today,
  initial,
}: {
  matterId: string;
  parents: { a: string; b: string };
  today: string;
  initial: (ScheduleInput & { id: string }) | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "Court-ordered schedule");
  const [start, setStart] = useState(initial?.cycle_start ?? today);
  const [days, setDays] = useState(initial?.cycle_days ?? 14);
  const [effFrom, setEffFrom] = useState(initial?.effective_from ?? today);
  const [effTo, setEffTo] = useState(initial?.effective_to ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [rows, setRows] = useState<T[]>(initial?.transitions ?? []);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const sorted = useMemo(
    () => [...rows].map((r, i) => ({ ...r, i })).sort((x, y) => x.day - y.day || x.time.localeCompare(y.time)),
    [rows]
  );
  const update = (i: number, patch: Partial<T>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await saveScheduleAction(matterId, {
      id: initial?.id,
      name,
      cycle_start: start,
      cycle_days: days,
      effective_from: effFrom,
      effective_to: effTo,
      notes,
      transitions: rows,
    });
    setBusy(false);
    if (res.ok) {
      setMsg({ ok: "Schedule saved." });
      router.refresh();
    } else setMsg({ error: res.error });
  }

  return (
    <div className="card">
      <h2>{initial ? "Regular schedule" : "Set up the regular schedule"}</h2>
      {msg?.ok && <div className="notice">{msg.ok}</div>}
      {msg?.error && <div className="notice error">{msg.error}</div>}

      {!initial && (
        <div className="field">
          <span className="label">Start from a common pattern</span>
          <div className="chips">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className="chip"
                style={{ padding: "6px 12px", cursor: "pointer" }}
                title={p.hint}
                onClick={() => {
                  setDays(p.days);
                  setRows(p.t);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <small className="muted">Then adjust days and times to match your decree exactly.</small>
        </div>
      )}

      <div className="field">
        <label htmlFor="sname">Name</label>
        <input id="sname" type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="row">
        <label className="grow muted" style={{ fontSize: "0.85rem" }}>
          Cycle starts on
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="muted" style={{ fontSize: "0.85rem", width: 120 }}>
          Repeats every
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[7, 14, 21, 28].map((d) => (
              <option key={d} value={d}>{d} days</option>
            ))}
          </select>
        </label>
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <span className="label">Exchanges in each cycle</span>
        {sorted.map(({ i, ...r }) => (
          <div key={i} className="row" style={{ marginBottom: 6 }}>
            <select value={r.day} onChange={(e) => update(i, { day: Number(e.target.value) })} style={{ flex: 2 }}>
              {Array.from({ length: days }, (_, d) => (
                <option key={d} value={d}>{weekdayLabel(start, d)}</option>
              ))}
            </select>
            <input type="time" value={r.time} onChange={(e) => update(i, { time: e.target.value })} style={{ flex: 1 }} />
            <select value={r.to} onChange={(e) => update(i, { to: e.target.value as "a" | "b" })} style={{ flex: 1.5 }}>
              <option value="a">to {parents.a}</option>
              <option value="b">to {parents.b}</option>
            </select>
            <button type="button" className="btn small danger" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove">
              ×
            </button>
          </div>
        ))}
        <button type="button" className="btn small" onClick={() => setRows([...rows, { day: 0, time: "18:00", to: "a" }])}>
          + Add exchange
        </button>
      </div>

      <div className="row">
        <label className="grow muted" style={{ fontSize: "0.85rem" }}>
          In effect from
          <input type="date" value={effFrom} onChange={(e) => setEffFrom(e.target.value)} />
        </label>
        <label className="grow muted" style={{ fontSize: "0.85rem" }}>
          Until (optional)
          <input type="date" value={effTo} onChange={(e) => setEffTo(e.target.value)} />
        </label>
      </div>
      <div className="field" style={{ marginTop: 10 }}>
        <label htmlFor="snotes">Notes (e.g. decree section)</label>
        <input id="snotes" type="text" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <button type="button" className="btn primary" onClick={save} disabled={busy}>
        {busy ? "Saving…" : "Save schedule"}
      </button>
    </div>
  );
}
