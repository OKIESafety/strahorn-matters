"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { recordExchangeAction, type CheckinInput } from "../actions";

type Side = "a" | "b";

function getPosition(): Promise<{ lat: number; lng: number; accuracy_m: number } | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy_m: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 }
    );
  });
}

const fmt = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });

/** The exchange happening now: one tap when they arrive late, or log that you're waiting / it didn't happen. */
export function LateNow({
  matterId,
  scheduled,
  isNow,
}: {
  matterId: string;
  scheduled: { at: number; to: Side; label: string; toName: string };
  isNow: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);

  async function record(kind: CheckinInput["kind"], label: string) {
    setBusy(true);
    setMsg(null);
    const pos = await getPosition();
    const res = await recordExchangeAction(matterId, {
      kind,
      to_parent: kind === "arrived" || kind === "late_notice" ? null : scheduled.to,
      note,
      lat: pos?.lat ?? null,
      lng: pos?.lng ?? null,
      accuracy_m: pos?.accuracy_m ?? null,
    });
    setBusy(false);
    if (!res.ok) return setMsg({ error: res.error });
    const at = Date.parse(res.at!);
    const late = Math.round((at - scheduled.at) / 60000);
    setMsg({
      ok: `${label} at ${fmt(at)}${kind === "handoff" && late > 0 ? ` (${late} min late)` : ""}${pos ? "" : " · location unavailable"}`,
    });
    setNote("");
    router.refresh();
  }

  return (
    <div className="card">
      <div className="muted" style={{ fontSize: "0.85rem" }}>{isNow ? "Scheduled exchange" : "Next scheduled exchange"}</div>
      <h2 style={{ margin: "4px 0 10px" }}>
        {scheduled.label} → {scheduled.toName}
      </h2>
      {msg?.ok && <div className="notice">{msg.ok}</div>}
      {msg?.error && <div className="notice error">{msg.error}</div>}
      <div className="stack">
        <button className="btn primary block big" disabled={busy} onClick={() => record("handoff", "Girls arrived")}>
          The girls just got here
        </button>
        <div className="row">
          <button className="btn grow" disabled={busy} onClick={() => record("arrived", "Logged that you're waiting")}>
            I&apos;m here, still waiting
          </button>
          <button className="btn grow" disabled={busy} onClick={() => record("late_notice", "Logged that they said they'd be late")}>
            She said she&apos;s running late
          </button>
        </div>
        <button className="btn danger" disabled={busy} onClick={() => record("no_show", "Logged that the exchange didn't happen")}>
          Exchange didn&apos;t happen
        </button>
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note (what was said, where)" />
      </div>
      <small className="muted">Saves the time and your phone&apos;s location. Entries can&apos;t be edited later, only voided.</small>
    </div>
  );
}

/** Pick a past scheduled exchange and enter when they actually arrived. */
export function LatePast({ matterId, options }: { matterId: string; options: { at: number; to: Side; label: string }[] }) {
  const router = useRouter();
  const [idx, setIdx] = useState(options.length ? "0" : "");
  const [time, setTime] = useState("");
  const [date, setDate] = useState("");
  const [what, setWhat] = useState<"late" | "no_show">("late");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);

  if (!options.length) return <p className="muted">No scheduled exchanges in the last 45 days.</p>;
  const sel = options[Number(idx)];
  const schedDate = new Date(sel.at).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await recordExchangeAction(matterId, {
      kind: what === "late" ? "handoff" : "no_show",
      to_parent: sel.to,
      note,
      lat: null,
      lng: null,
      accuracy_m: null,
      date: what === "late" ? date || schedDate : schedDate,
      time: what === "late" ? time : new Date(sel.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "America/Chicago" }),
    });
    setBusy(false);
    if (!res.ok) return setMsg({ error: res.error });
    const late = what === "late" ? Math.round((Date.parse(res.at!) - sel.at) / 60000) : 0;
    setMsg({ ok: what === "late" ? `Saved: ${late > 0 ? `${late} min late` : "arrival time recorded"}.` : "Saved: didn't happen." });
    setTime("");
    setNote("");
    router.refresh();
  }

  return (
    <form onSubmit={submit}>
      {msg?.ok && <div className="notice">{msg.ok}</div>}
      {msg?.error && <div className="notice error">{msg.error}</div>}
      <select value={idx} onChange={(e) => setIdx(e.target.value)}>
        {options.map((o, i) => (
          <option key={o.at} value={i}>{o.label}</option>
        ))}
      </select>
      <div className="row" style={{ marginTop: 8 }}>
        <select value={what} onChange={(e) => setWhat(e.target.value as "late" | "no_show")} style={{ flex: 1 }}>
          <option value="late">They arrived late at…</option>
          <option value="no_show">It didn&apos;t happen</option>
        </select>
        {what === "late" && (
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required style={{ flex: 1 }} />
        )}
      </div>
      {what === "late" && (
        <label className="muted" style={{ fontSize: "0.8rem", display: "block", marginTop: 6 }}>
          Different day than scheduled? (optional)
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      )}
      <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note / source (e.g. her text at 9:12 PM)" style={{ marginTop: 8 }} />
      <button className="btn" disabled={busy} style={{ marginTop: 8 }}>{busy ? "Saving…" : "Save"}</button>
    </form>
  );
}
