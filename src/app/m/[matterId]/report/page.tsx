import { requireMatter } from "@/lib/access";
import { loadEvents, loadFilterOptions } from "@/lib/queries";
import { formatDate, formatTime, formatTimestamp, shortId } from "@/lib/format";
import { CONFIDENCE } from "@/lib/constants";
import { Filters, readFilters } from "@/components/filters";
import { PrintButton } from "./print-button";

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ matterId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { matterId } = await params;
  const f = readFilters(await searchParams);
  const { supabase, matter } = await requireMatter(matterId);

  const [{ rows, total }, opts] = await Promise.all([
    loadEvents(supabase, matterId, f, { ascending: true, limit: 1000 }),
    loadFilterOptions(supabase, matterId),
  ]);

  // Evidence for the listed events (filenames, page refs, quotes, hashes)
  const ids = rows.map((r) => r.id);
  const evByEvent = new Map<string, any[]>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase
      .from("event_evidence")
      .select("event_id, excerpt, page_ref, evidence(id, original_filename, sha256)")
      .in("event_id", ids.slice(i, i + 200));
    for (const l of (data ?? []) as any[]) {
      const list = evByEvent.get(l.event_id) ?? [];
      list.push(l);
      evByEvent.set(l.event_id, list);
    }
  }

  const issueName = f.issue ? opts.issues.find((i) => i.id === f.issue)?.title : null;
  const personName = f.person ? opts.people.find((p) => p.id === f.person)?.name : null;
  const scope = [
    issueName && `Issue: ${issueName}`,
    f.tag && `Tag: ${f.tag}`,
    personName && `Person: ${personName}`,
    f.confidence && `Confidence: ${CONFIDENCE.find((c) => c.value === f.confidence)?.label}`,
    (f.from || f.to) && `Dates: ${f.from ? formatDate(f.from) : "start"} – ${f.to ? formatDate(f.to) : "present"}`,
    f.q && `Search: “${f.q}”`,
  ].filter(Boolean);

  return (
    <>
      <div className="no-print">
        <h1>Report</h1>
        <p className="muted">
          Pick filters, then print or “Save as PDF” to share with your attorney. Events are listed oldest first.
        </p>
        <Filters f={f} opts={opts} action={`/m/${matterId}/report`} />
        <PrintButton />
      </div>

      <section style={{ marginTop: 20 }}>
        <h1>{matter.title}{issueName ? ` — ${issueName}` : ""}</h1>
        <p className="muted" style={{ fontSize: "0.9rem" }}>
          {total} event{total === 1 ? "" : "s"} · Generated {formatTimestamp(new Date().toISOString())}
          {scope.length ? ` · ${scope.join(" · ")}` : ""}
        </p>

        {rows.map((e, n) => (
          <div key={e.id} className="card">
            <div className="row between">
              <strong>
                {n + 1}. {formatDate(e.event_date)}
                {e.event_time ? `, ${formatTime(e.event_time)}` : ""}
              </strong>
              <small>{CONFIDENCE.find((c) => c.value === e.confidence)?.label}</small>
            </div>
            <div className="event-title">{e.title}</div>
            {e.summary && <p style={{ whiteSpace: "pre-wrap", marginBottom: 6 }}>{e.summary}</p>}
            {e.details && <p style={{ whiteSpace: "pre-wrap", marginBottom: 6 }}>{e.details}</p>}
            <small className="muted">
              {[
                e.people.length ? `People: ${e.people.map((p) => p.name).join(", ")}` : null,
                e.issues.length ? `Issues: ${e.issues.map((i) => i.title).join(", ")}` : null,
                e.source_ref ? `Source: ${e.source_ref}` : null,
                `Ref ${shortId(e.id)}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </small>
            {(evByEvent.get(e.id) ?? []).map((l: any) => (
              <div key={l.evidence?.id} style={{ marginTop: 6, fontSize: "0.88rem" }}>
                📎 {l.evidence?.original_filename}
                {l.page_ref ? ` (${l.page_ref})` : ""}{" "}
                <span className="muted mono">sha256 {String(l.evidence?.sha256 ?? "").slice(0, 16)}…</span>
                {l.excerpt && <div className="quote">“{l.excerpt}”</div>}
              </div>
            ))}
          </div>
        ))}
      </section>
    </>
  );
}
