import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMatter } from "@/lib/access";
import { loadParents, formatInstant } from "@/lib/time-data";
import { todayLocal } from "@/lib/format";
import { CheckinButtons, PastExchangeForm } from "./client";
import { voidExchangeAction } from "../actions";

const KIND: Record<string, string> = {
  handoff: "Exchange",
  arrived: "Arrived / waiting",
  no_show: "Didn't happen",
  late_notice: "Told they'd be late",
};

export default async function CheckinPage({ params }: { params: Promise<{ matterId: string }> }) {
  const { matterId } = await params;
  const { supabase, canWrite } = await requireMatter(matterId);
  if (!canWrite) redirect(`/m/${matterId}/time`);
  const parents = await loadParents(supabase, matterId);
  if (!parents.set) redirect(`/m/${matterId}/time`);

  const { data: recent } = await supabase
    .from("exchanges")
    .select("id, occurred_at, kind, to_parent, recorded_live, lat, lng, accuracy_m, note, voided_at, void_reason")
    .eq("matter_id", matterId)
    .order("occurred_at", { ascending: false })
    .limit(15);

  const name = (s: string | null) => (s === "a" ? parents.a : s === "b" ? parents.b : "");

  return (
    <>
      <div className="row between">
        <h1>Check in</h1>
        <Link href={`/m/${matterId}/time`} className="btn small">Parenting time</Link>
      </div>
      <p className="muted" style={{ fontSize: "0.9rem" }}>
        Tap at the moment it happens. The time and your phone&apos;s location are saved and can&apos;t be edited later.
      </p>

      <CheckinButtons matterId={matterId} parents={{ a: parents.a, b: parents.b }} />

      <div className="card" id="past">
        <h2>Add a past exchange</h2>
        <p className="muted" style={{ fontSize: "0.88rem" }}>
          For exchanges you didn&apos;t check in live. These are marked &quot;entered later&quot;.
        </p>
        <PastExchangeForm matterId={matterId} parents={{ a: parents.a, b: parents.b }} today={todayLocal()} />
      </div>

      <div className="card">
        <h2>Recent</h2>
        {(recent ?? []).length === 0 && <p className="muted">Nothing recorded yet.</p>}
        {(recent ?? []).map((x) => (
          <div key={x.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--border)", opacity: x.voided_at ? 0.55 : 1 }}>
            <div className="row between">
              <strong style={{ textDecoration: x.voided_at ? "line-through" : "none" }}>
                {KIND[x.kind]}
                {x.to_parent ? ` → ${name(x.to_parent)}` : ""}
              </strong>
              <small className="muted">{x.recorded_live ? "Live" : "Entered later"}</small>
            </div>
            <small className="muted">
              {formatInstant(Date.parse(x.occurred_at))}
              {x.lat != null && x.lng != null && (
                <>
                  {" · "}
                  <a href={`https://maps.apple.com/?q=${x.lat},${x.lng}`} target="_blank" rel="noreferrer">
                    location ±{Math.round(x.accuracy_m ?? 0)}m
                  </a>
                </>
              )}
            </small>
            {x.note && <div style={{ fontSize: "0.9rem" }}>{x.note}</div>}
            {x.voided_at ? (
              <small className="muted">Voided: {x.void_reason}</small>
            ) : (
              <details>
                <summary className="muted" style={{ cursor: "pointer", fontSize: "0.8rem" }}>Void this entry…</summary>
                <form action={voidExchangeAction.bind(null, matterId, x.id)} className="row" style={{ marginTop: 6 }}>
                  <input name="reason" type="text" required placeholder="Why (e.g. tapped by mistake)" style={{ flex: 1 }} />
                  <button className="btn small danger">Void</button>
                </form>
              </details>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
