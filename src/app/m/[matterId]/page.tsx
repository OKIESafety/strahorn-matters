import Link from "next/link";
import { requireMatter } from "@/lib/access";
import { loadEvents, loadFilterOptions } from "@/lib/queries";
import { formatMonth } from "@/lib/format";
import { EventCard } from "@/components/event-card";
import { Filters, readFilters } from "@/components/filters";

export default async function Timeline({
  params,
  searchParams,
}: {
  params: Promise<{ matterId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { matterId } = await params;
  const sp = await searchParams;
  const f = readFilters(sp);
  const { supabase, canWrite } = await requireMatter(matterId);
  const base = `/m/${matterId}`;

  const [{ rows, total }, opts, { count: reviewCount }] = await Promise.all([
    loadEvents(supabase, matterId, f),
    loadFilterOptions(supabase, matterId),
    supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("matter_id", matterId)
      .eq("confidence", "needs_review"),
  ]);

  let lastMonth = "";

  return (
    <>
      {sp.saved && <div className="notice">Saved.</div>}
      {!f.confidence && (reviewCount ?? 0) > 0 && (
        <Link href={`${base}?confidence=needs_review`} className="notice warn" style={{ display: "block" }}>
          {reviewCount} event{reviewCount === 1 ? "" : "s"} still need{reviewCount === 1 ? "s" : ""} a quick review →
        </Link>
      )}

      <Filters f={f} opts={opts} action={base} />

      <p className="muted" style={{ fontSize: "0.9rem" }}>
        {total} event{total === 1 ? "" : "s"}
        {total > rows.length ? ` (showing newest ${rows.length})` : ""}
      </p>

      {rows.length === 0 && (
        <div className="card">
          <p>No events yet{Object.values(f).some(Boolean) ? " match these filters" : ""}.</p>
          {canWrite && <Link className="btn primary" href={`${base}/new`}>Add the first event</Link>}
        </div>
      )}

      {rows.map((e) => {
        const month = e.event_date.slice(0, 7);
        const header = month !== lastMonth ? <div className="month">{formatMonth(e.event_date)}</div> : null;
        lastMonth = month;
        return (
          <div key={e.id}>
            {header}
            <EventCard e={e} href={`${base}/e/${e.id}`} />
          </div>
        );
      })}

      {canWrite && (
        <Link href={`${base}/new`} className="fab">
          + New event
        </Link>
      )}
    </>
  );
}
