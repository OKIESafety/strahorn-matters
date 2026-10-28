import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMatter } from "@/lib/access";
import { loadParents, loadTimeData, formatInstant } from "@/lib/time-data";
import { todayLocal } from "@/lib/format";
import { ScheduleEditor } from "./editor";
import { addOverrideAction, deleteOverrideAction, deleteScheduleAction, saveParentsAction } from "../actions";

export default async function SchedulePage({ params }: { params: Promise<{ matterId: string }> }) {
  const { matterId } = await params;
  const { supabase, canWrite, isOwner } = await requireMatter(matterId);
  if (!canWrite) redirect(`/m/${matterId}/time`);
  const parents = await loadParents(supabase, matterId);
  const { schedules, overrides } = await loadTimeData(supabase, matterId);
  const current = schedules[schedules.length - 1];

  return (
    <>
      <div className="row between">
        <h1>Schedule</h1>
        <Link href={`/m/${matterId}/time`} className="btn small">Done</Link>
      </div>

      {isOwner && (
        <details className="card">
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>
            Parents: {parents.a} &amp; {parents.b}
          </summary>
          <form action={saveParentsAction.bind(null, matterId)} className="row" style={{ marginTop: 10 }}>
            <input name="parent_a" type="text" defaultValue={parents.a} required style={{ flex: 1, minWidth: 120 }} />
            <input name="parent_b" type="text" defaultValue={parents.b} required style={{ flex: 1, minWidth: 120 }} />
            <button className="btn">Save</button>
          </form>
        </details>
      )}

      <ScheduleEditor
        matterId={matterId}
        parents={{ a: parents.a, b: parents.b }}
        today={todayLocal()}
        initial={
          current
            ? {
                id: current.id,
                name: current.name,
                cycle_start: current.cycle_start,
                cycle_days: current.cycle_days,
                effective_from: current.effective_from,
                effective_to: current.effective_to ?? "",
                notes: current.notes ?? "",
                transitions: current.transitions,
              }
            : null
        }
      />

      {isOwner && schedules.length > 1 && (
        <div className="card">
          <h3>Earlier schedules</h3>
          {schedules.slice(0, -1).map((s) => (
            <form key={s.id} action={deleteScheduleAction.bind(null, matterId, s.id)} className="row between">
              <span>
                {s.name} · from {s.effective_from}
                {s.effective_to ? ` to ${s.effective_to}` : ""}
              </span>
              <button className="btn small danger">Remove</button>
            </form>
          ))}
        </div>
      )}

      <div className="card">
        <h2>Agreed changes</h2>
        <p className="muted" style={{ fontSize: "0.9rem" }}>
          Holidays, vacations or swaps you both agreed to. These replace the regular schedule for that period.
        </p>
        {overrides.map((o) => (
          <form key={o.id} action={deleteOverrideAction.bind(null, matterId, o.id)} className="row between" style={{ marginBottom: 8 }}>
            <span style={{ fontSize: "0.9rem" }}>
              <b>{o.parent === "a" ? parents.a : parents.b}</b>: {formatInstant(Date.parse(o.starts_at))} →{" "}
              {formatInstant(Date.parse(o.ends_at))}
              {o.reason ? <span className="muted"> · {o.reason}</span> : null}
            </span>
            <button className="btn small danger">Remove</button>
          </form>
        ))}
        <form action={addOverrideAction.bind(null, matterId)} style={{ marginTop: 10 }}>
          <div className="row">
            <label className="grow muted" style={{ fontSize: "0.85rem" }}>
              Starts
              <input type="date" name="start_date" required />
            </label>
            <label className="grow muted" style={{ fontSize: "0.85rem" }}>
              Time
              <input type="time" name="start_time" defaultValue="18:00" />
            </label>
          </div>
          <div className="row">
            <label className="grow muted" style={{ fontSize: "0.85rem" }}>
              Ends
              <input type="date" name="end_date" required />
            </label>
            <label className="grow muted" style={{ fontSize: "0.85rem" }}>
              Time
              <input type="time" name="end_time" defaultValue="18:00" />
            </label>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <select name="parent" required defaultValue="" style={{ flex: 1 }}>
              <option value="" disabled>Children with…</option>
              <option value="a">{parents.a}</option>
              <option value="b">{parents.b}</option>
            </select>
            <input name="reason" type="text" placeholder="Reason (e.g. Thanksgiving)" style={{ flex: 2 }} />
          </div>
          <button className="btn" style={{ marginTop: 8 }}>Add change</button>
        </form>
      </div>
    </>
  );
}
