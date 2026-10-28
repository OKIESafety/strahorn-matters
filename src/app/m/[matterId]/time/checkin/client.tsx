"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { recordExchangeAction, type CheckinInput } from "../actions";

type Parents = { a: string; b: string };

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

export function CheckinButtons({ matterId, parents }: { matterId: string; parents: Parents }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);

  async function record(kind: CheckinInput["kind"], to: "a" | "b" | null, label: string) {
    setBusy(true);
    setMsg(null);
    const pos = await getPosition();
    const res = await recordExchangeAction(matterId, {
      kind,
      to_parent: to,
      note,
      lat: pos?.lat ?? null,
      lng: pos?.lng ?? null,
      accuracy_m: pos?.accuracy_m ?? null,
    });
    setBusy(false);
    if (!res.ok) return setMsg({ error: res.error });
    const t = new Date(res.at!).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
    setMsg({ ok: `Saved: ${label} at ${t}${pos ? "" : " (location unavailable)"}` });
    setNote("");
    router.refresh();
  }

  return (
    <div className="card">
      {msg?.ok && <div className="notice">{msg.ok}</div>}
      {msg?.error && <div className="notice error">{msg.error}</div>}
      <div className="stack">
        <button className="btn primary block big" disabled={busy} onClick={() => record("handoff", "a", `Kids now with ${parents.a}`)}>
          Kids now with {parents.a}
        </button>
        <button className="btn primary block big" disabled={busy} onClick={() => record("handoff", "b", `Kids now with ${parents.b}`)}>
          Kids now with {parents.b}
        </button>
        <div className="row">
          <button className="btn grow" disabled={busy} onClick={() => record("arrived", null, "Arrived / waiting")}>
            I&apos;m here, waiting
          </button>
          <button className="btn grow" disabled={busy} onClick={() => record("late_notice", null, "Told they'd be late")}>
            They said they&apos;re late
          </button>
        </div>
        <details>
          <summary className="muted" style={{ cursor: "pointer", fontSize: "0.88rem" }}>Exchange didn&apos;t happen…</summary>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn grow danger" disabled={busy} onClick={() => record("no_show", "a", `No-show: handoff to ${parents.a}`)}>
              Handoff to {parents.a} didn&apos;t happen
            </button>
            <button className="btn grow danger" disabled={busy} onClick={() => record("no_show", "b", `No-show: handoff to ${parents.b}`)}>
              Handoff to {parents.b} didn&apos;t happen
            </button>
          </div>
        </details>
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note (e.g. where, who was there)" />
      </div>
    </div>
  );
}

export function PastExchangeForm({ matterId, parents, today }: { matterId: string; parents: Parents; today: string }) {
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("18:00");
  const [kind, setKind] = useState<CheckinInput["kind"]>("handoff");
  const [to, setTo] = useState<"a" | "b" | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await recordExchangeAction(matterId, {
      kind,
      to_parent: to || null,
      note,
      lat: null,
      lng: null,
      accuracy_m: null,
      date,
      time,
    });
    setBusy(false);
    if (!res.ok) return setMsg({ error: res.error });
    setMsg({ ok: "Saved." });
    setNote("");
    router.refresh();
  }

  return (
    <form onSubmit={submit}>
      {msg?.ok && <div className="notice">{msg.ok}</div>}
      {msg?.error && <div className="notice error">{msg.error}</div>}
      <div className="row">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required style={{ flex: 1.3 }} />
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required style={{ flex: 1 }} />
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <select value={kind} onChange={(e) => setKind(e.target.value as CheckinInput["kind"])} style={{ flex: 1 }}>
          <option value="handoff">Exchange happened</option>
          <option value="no_show">Exchange didn&apos;t happen</option>
          <option value="late_notice">Told they&apos;d be late</option>
          <option value="arrived">Arrived / waiting</option>
        </select>
        <select value={to} onChange={(e) => setTo(e.target.value as "a" | "b" | "")} style={{ flex: 1 }}>
          <option value="">Kids went to…</option>
          <option value="a">{parents.a}</option>
          <option value="b">{parents.b}</option>
        </select>
      </div>
      <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note / source (e.g. text at 9:12 PM)" style={{ marginTop: 8 }} />
      <button className="btn" disabled={busy} style={{ marginTop: 8 }}>
        {busy ? "Saving…" : "Save past exchange"}
      </button>
    </form>
  );
}
