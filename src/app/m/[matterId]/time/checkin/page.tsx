import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMatter } from "@/lib/access";
import { loadParents, formatInstant, scheduledHandoffs } from "@/lib/time-data";
import { LateNow, LatePast } from "./client";
import { voidExchangeAction } from "../actions";

const KIND: Record<string, string> = {
  handoff: "Arrived",
  arrived: "Waiting (I was there)",
  no_show: "Didn't happen",
  late_notice: "Said they'd be late",
};

const HOUR = 3_600_000;

export default async function LatePage({ params }: { params: Promise<{ matterId: string }> }) {
  const { matterId } = await params;
  const { supabase, canWrite } = await requireMatter(matterId);
  if (!canWrite) redirect(`/m/${matterId}/time`);
  const parents = await loadParents(supabase, matterId);
  if (!parents.set) redirect(`/m/${matterId}/time`);

  const now = Date.now();
  // Exchanges from the last 45 days through the next 2 days
  const list = await scheduledHandoffs(supabase, matterId, now - 45 * 24 * HOUR, now + 48 * HOUR);
  const name = (s: string | null) => (s === "a" ? parents.a : s === "b" ? parents.b : "");

  // The exchange that's happening now: the closest one within 12 hours, otherwise the next one
  const near = list.filter((t) => Math.abs(t.at - now) <= 12 * HOUR).sort((x, y) => Math.abs(x.at - now) - Math.abs(y.at - now))[0];
  const next = near ?? list.find((t) => t.at > now) ?? null;
  const past = list.filter((t) => t.at <= now).reverse().slice(0, 25);

  const { data: recent } = await supabase
    .from("exchanges")
    .select("id, occurred_at, kind, to_parent, recorded_live, lat, lng, accuracy_m, note, voided_at, void_reason")
    .eq("matter_id", matterId)
    .order("occurred_at", { ascending: false })
    .limit(15);

  return (
    <>
      <div className="row between">
        <h1>Girls late?</h1>
        <Link href={`/m/${matterId}/time`} className="btn small">Parenting time</Link>
      </div>
      <p className="muted" style={{ fontSize: "0.9rem" }}>
        Only log when an exchange is late or doesn&apos;t happen. Everything else is assumed on schedule.
      </p>

      {list.length === 0 ? (
        <div className="card">
          No schedule yet. <Link href={`/m/${matterId}/time/schedule`}>Set it up</Link> first.
        </div>
      ) : (
        <>
          {next && (
            <LateNow
              matterId={matterId}
              scheduled={{ at: next.at, to: next.to, label: formatInstant(next.at), toName: name(next.to) }}
              isNow={!!near}
            />
          )}
          <div className="card" id="past">
            <h2>Log a late exchange from earlier</h2>
            <LatePast
              matterId={matterId}
              options={past.map((t) => ({ at: t.at, to: t.to, label: `${formatInstant(t.at)} → ${name(t.to)}` }))}
            />
          </div>
        </>
      )}

      <div className="card">
        <h2>Logged</h2>
        {(recent ?? []).length === 0 && <p className="muted">Nothing logged yet.</p>}
        {(recent ?? []).map((x) => (
          <div key={x.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--border)", opacity: x.voided_at ? 0.55 : 1 }}>
            <div className="row between">
              <strong style={{ textDecoration: x.voided_at ? "line-through" : "none" }}>
                {KIND[x.kind]}
                {x.to_parent ? ` (to ${name(x.to_parent)})` : ""}
              </strong>
              <small className="muted">{x.recorded_live ? "Logged live" : "Entered later"}</small>
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
