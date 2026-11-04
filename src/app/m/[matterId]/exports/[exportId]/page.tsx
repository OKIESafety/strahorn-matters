import { notFound } from "next/navigation";
import { requireMatter } from "@/lib/access";
import { formatDate, formatTime, formatTimestamp } from "@/lib/format";
import { qrSvg, siteOrigin } from "@/lib/qr";
import { loadCase } from "@/lib/orders";
import { loadParents } from "@/lib/time-data";
import { buildAppendix, groupForReport, type ExportItem } from "@/lib/report-data";
import type { PacketStats } from "@/lib/packet";
import { ColumnChart, IssueTimeline, ShareCompare, StackedMonths, issueColor } from "@/components/report-charts";
import { PrintButton } from "../../report/print-button";

type OrderSnap = { category: string; title: string; summary: string; quote: string | null; citation: string | null; key_fact: boolean };

const short = (d: string) => formatDate(d).replace(/^\w+, /, "");
const TEXT_LIMIT = 40_000;

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function ExportPage({ params }: { params: Promise<{ matterId: string; exportId: string }> }) {
  const { matterId, exportId } = await params;
  const { supabase } = await requireMatter(matterId);
  const { data: ex } = await supabase
    .from("exports")
    .select("id, title, items, manifest_sha256, created_at, filters, summary, orders, stats, manifest_version, issue_summaries")
    .eq("id", exportId)
    .eq("matter_id", matterId)
    .maybeSingle();
  if (!ex) notFound();

  // Older packets weren't grouped by issue; group them for display (their numbering is kept).
  const raw = ex.items as ExportItem[];
  const items: ExportItem[] =
    ex.manifest_version >= 3
      ? raw
      : groupForReport(raw).map((g) => ({ ...g, exhibit: raw.find((r) => r.event_id === g.event_id)!.exhibit }));
  const orders = (ex.orders ?? []) as OrderSnap[];
  const stats = (ex.stats ?? null) as PacketStats | null;
  const issueSummaries = new Map(((ex.issue_summaries ?? []) as { issue: string; summary: string }[]).map((x) => [x.issue.toLowerCase(), x.summary]));
  const [c, parents] = await Promise.all([loadCase(supabase, matterId), loadParents(supabase, matterId)]);

  // Groups in report order, each with its color
  const groupOrder: string[] = [];
  for (const i of items) {
    const g = i.group ?? i.issues[0] ?? "Other events";
    if (!groupOrder.includes(g)) groupOrder.push(g);
  }
  const color = new Map(groupOrder.map((g, i) => [g, g === "Other events" ? "#9ca3af" : issueColor(i)]));
  const byGroup = groupOrder.map((g) => ({
    label: g,
    color: color.get(g)!,
    items: items.filter((i) => (i.group ?? i.issues[0] ?? "Other events") === g),
  }));
  const { data: issueRows } = await supabase.from("issues").select("title, description").eq("matter_id", matterId);
  const issueDesc = new Map((issueRows ?? []).map((r: any) => [String(r.title).toLowerCase(), r.description as string | null]));

  // Appendix with signed links, and full text for short text files
  const appendix = buildAppendix(items);
  const refOf = new Map(appendix.map((a) => [a.id, a.ref]));
  const urls = new Map<string, string | null>();
  const texts = new Map<string, string>();
  if (appendix.length) {
    const { data: ev } = await supabase
      .from("evidence")
      .select("id, storage_path, size_bytes, mime_type, original_filename")
      .in("id", appendix.map((a) => a.id));
    const rows = (ev ?? []) as any[];
    const { data: signed } = await supabase.storage.from("evidence").createSignedUrls(rows.map((e) => e.storage_path), 3600);
    const byPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
    for (const e of rows) urls.set(e.id, byPath.get(e.storage_path) ?? null);
    await Promise.all(
      rows
        .filter(
          (e) =>
            (e.size_bytes ?? 0) <= TEXT_LIMIT &&
            ((e.mime_type ?? "").startsWith("text/") || /\.(txt|csv|md)$/i.test(e.original_filename))
        )
        .map(async (e) => {
          const { data } = await supabase.storage.from("evidence").download(e.storage_path);
          if (data) texts.set(e.id, await data.text());
        })
    );
  }

  // Months for the stacked chart
  const dates = items.map((i) => i.date).sort();
  const monthKeys: string[] = [];
  if (dates.length) {
    let y = Number(dates[0].slice(0, 4));
    let m = Number(dates[0].slice(5, 7));
    const end = dates[dates.length - 1].slice(0, 7);
    while (monthKeys.length < 60) {
      const k = `${y}-${String(m).padStart(2, "0")}`;
      monthKeys.push(k);
      if (k >= end) break;
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
  }
  const monthLabel = (k: string) =>
    new Date(Date.UTC(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, 15)).toLocaleDateString("en-US", {
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    });

  const verifyUrl = `${await siteOrigin()}/verify/${ex.id}`;
  const qr = await qrSvg(verifyUrl);
  const keyFacts = orders.filter((o) => o.key_fact && o.category !== "Case");
  const disputeTerms = orders.filter((o) => o.category === "Disputes & going back to court");
  const p = stats?.parenting ?? null;
  let sec = 0;
  const next = () => ++sec;

  return (
    <div className="packet">
      <div className="no-print row between" style={{ marginBottom: 12 }}>
        <span className="muted">Attorney report</span>
        <div className="row">
          {appendix.length > 0 && (
            <a className="btn" href={`/m/${matterId}/exports/${ex.id}/download`}>Download files (ZIP)</a>
          )}
          <PrintButton />
        </div>
      </div>

      {/* ── Cover ── */}
      <section className="cover-page">
        <div className="eyebrow">Prepared for counsel · Confidential</div>
        <h1 className="report-title">{ex.title}</h1>
        {c.caption && <div className="case-caption">{c.caption}</div>}
        <div className="muted">{[c.case_number && `Case No. ${c.case_number}`, c.court].filter(Boolean).join(" · ")}</div>
        <dl className="kv" style={{ marginTop: 18 }}>
          <dt>Prepared by</dt>
          <dd>{parents.set ? `${parents.a} Strahorn` : "—"}</dd>
          <dt>Prepared on</dt>
          <dd>{formatTimestamp(ex.created_at)}</dd>
          <dt>Contents</dt>
          <dd>
            Overview · Patterns · Issues · Court order · Events by issue · Appendix of source messages and photos
          </dd>
        </dl>
        <div className="verify-box" style={{ marginTop: 20 }}>
          <div className="qr" dangerouslySetInnerHTML={{ __html: qr }} />
          <div>
            <b>Verify this report</b>
            <div style={{ fontSize: "0.85rem", wordBreak: "break-all" }}>{verifyUrl}</div>
            <div className="mono" style={{ fontSize: "0.7rem", wordBreak: "break-all", marginTop: 6 }}>
              Fingerprint (SHA-256): {ex.manifest_sha256}
            </div>
            <small className="muted">Scan to confirm this report and every attached file are unchanged since they were recorded.</small>
          </div>
        </div>
      </section>

      {/* ── 1. Overview ── */}
      <section className="report-section page-break">
        <h2 className="section-title"><span>{next()}</span> Overview</h2>
        <div className="cover-figures">
          <div><b>{items.length}</b><span>documented events</span></div>
          <div><b>{byGroup.filter((g) => g.label !== "Other events").length}</b><span>issues</span></div>
          <div><b>{appendix.length}</b><span>source messages &amp; photos</span></div>
          {dates.length > 0 && (
            <div>
              <b className="small">{short(dates[0])}</b>
              <span>to {short(dates[dates.length - 1])}</span>
            </div>
          )}
          {p && <div><b>{p.late}</b><span>late exchanges</span></div>}
          {p && <div><b>{p.actual_pct.a}%</b><span>actual time with {p.parents.a}</span></div>}
        </div>
        <table className="simple issue-table" style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th>Issue</th>
              <th style={{ textAlign: "right" }}>Events</th>
              <th>First</th>
              <th>Most recent</th>
            </tr>
          </thead>
          <tbody>
            {byGroup.map((g) => (
              <tr key={g.label}>
                <td>
                  <span className="swatch" style={{ background: g.color }} /> {g.label}
                </td>
                <td style={{ textAlign: "right" }}><b>{g.items.length}</b></td>
                <td>{short(g.items[0].date)}</td>
                <td>{short(g.items[g.items.length - 1].date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {ex.summary && (
          <>
            <h3 style={{ marginTop: 20 }}>Summary</h3>
            <div className="summary-text">{ex.summary}</div>
          </>
        )}
      </section>

      {/* ── 2. Patterns ── */}
      <section className="report-section page-break">
        <h2 className="section-title"><span>{next()}</span> Patterns at a glance</h2>
        <div className="chart-card">
          <h3>When events happened, by issue</h3>
          <div className="muted chart-note">Each dot is one documented event.</div>
          <IssueTimeline groups={byGroup.map((g) => ({ label: g.label, color: g.color, dates: g.items.map((i) => i.date) }))} />
        </div>
        {monthKeys.length > 1 && (
          <div className="chart-card">
            <h3>Events per month</h3>
            <StackedMonths
              months={monthKeys.map(monthLabel)}
              series={byGroup.map((g) => ({
                label: g.label,
                color: g.color,
                values: monthKeys.map((k) => g.items.filter((i) => i.date.startsWith(k)).length),
              }))}
            />
            <div className="legend">
              {byGroup.map((g) => (
                <span key={g.label}><span className="swatch" style={{ background: g.color }} /> {g.label}</span>
              ))}
            </div>
          </div>
        )}
        {p && (
          <div className="chart-card">
            <h3>Parenting time: court-ordered vs actual</h3>
            <div className="muted chart-note">
              {formatDate(p.from)} – {formatDate(p.to)} · court-ordered schedule with agreed holiday changes, compared with
              recorded late and missed exchanges
            </div>
            <ShareCompare parents={p.parents} ordered={p.scheduled_pct} actual={p.actual_pct} />
            <div className="stat-row">
              <div><b>{p.late}</b><span>late exchanges</span></div>
              <div><b>{p.late_minutes}</b><span>minutes late in total</span></div>
              <div><b>{p.no_show}</b><span>exchanges that didn&apos;t happen</span></div>
            </div>
            {p.late > 0 && (
              <>
                <h4>Late exchanges by month</h4>
                <ColumnChart data={p.late_by_month} color="#c0583b" label="Late exchanges by month" />
              </>
            )}
          </div>
        )}
      </section>

      {/* ── 3. What the events are about ── */}
      <section className="report-section page-break">
        <h2 className="section-title"><span>{next()}</span> What the events are about</h2>
        <div className="issue-cards">
          {byGroup.map((g) => {
            const text = issueSummaries.get(g.label.toLowerCase()) ?? issueDesc.get(g.label.toLowerCase()) ?? null;
            const first = g.items[0].exhibit;
            const last = g.items[g.items.length - 1].exhibit;
            return (
              <div key={g.label} className="issue-card" style={{ borderTopColor: g.color }}>
                <div className="row between">
                  <strong>{g.label}</strong>
                  <span className="pill" style={{ background: g.color }}>{g.items.length}</span>
                </div>
                <div className="muted" style={{ fontSize: "0.8rem" }}>
                  {short(g.items[0].date)} – {short(g.items[g.items.length - 1].date)} · Events {first === last ? first : `${first}–${last}`}
                </div>
                {text && <p style={{ margin: "6px 0 0" }}>{text}</p>}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── 4. Court order ── */}
      {orders.length > 0 && (
        <section className="report-section page-break">
          <h2 className="section-title"><span>{next()}</span> What the court order provides</h2>
          <div className="glance">
            {keyFacts.map((o, i) => (
              <div key={i} className="glance-item">
                <div className="glance-title">{o.title}</div>
                <div>{o.summary}</div>
                {o.citation && <div className="cite">{o.citation}</div>}
              </div>
            ))}
          </div>
          {disputeTerms.length > 0 && (
            <>
              <h3 style={{ marginTop: 18 }}>Resolving disputes and returning to court</h3>
              {disputeTerms.map((o, i) => (
                <div key={i} className="provision">
                  <strong>{o.title}</strong>
                  <div>{o.summary}</div>
                  {o.quote && <div className="quote">“{o.quote}”</div>}
                  {o.citation && <div className="cite">{o.citation}</div>}
                </div>
              ))}
            </>
          )}
        </section>
      )}

      {/* ── 5. Events by issue ── */}
      <section className="report-section page-break">
        <h2 className="section-title"><span>{next()}</span> Events by issue</h2>
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          Grouped by issue and listed oldest to newest. “Proof” points to the source messages and photos in the Appendix.
        </p>
        {byGroup.map((g) => (
          <div key={g.label} className="event-group">
            <h3 className="group-head" style={{ borderLeftColor: g.color }}>
              {g.label} <span className="muted">· {g.items.length} event{g.items.length === 1 ? "" : "s"}</span>
            </h3>
            {g.items.map((e) => {
              const refs = Array.from(new Set(e.evidence.map((v) => refOf.get(v.id)).filter(Boolean)));
              const also = e.issues.filter((t) => t !== g.label);
              return (
                <div key={e.exhibit} className="event-row">
                  <div className="event-num" style={{ background: g.color }}>{e.exhibit}</div>
                  <div className="grow">
                    <div className="event-when">
                      {formatDate(e.date)}
                      {e.time ? ` · ${formatTime(e.time)}` : ""}
                    </div>
                    <div className="event-title">{e.title}</div>
                    {e.summary && <div>{e.summary}</div>}
                    {e.details && <div className="muted" style={{ fontSize: "0.9rem", whiteSpace: "pre-wrap" }}>{e.details}</div>}
                    {e.evidence
                      .filter((v) => v.excerpt)
                      .map((v, j) => (
                        <div key={j} className="quote">
                          “{v.excerpt}”{" "}
                          <span className="cite" style={{ display: "inline" }}>
                            ({refOf.get(v.id)}{v.page_ref ? `, ${v.page_ref}` : ""})
                          </span>
                        </div>
                      ))}
                    <div className="event-meta">
                      {refs.length > 0 && <span><b>Proof:</b> {refs.join(", ")}</span>}
                      {e.people.length > 0 && <span>People: {e.people.join(", ")}</span>}
                      {e.attended_by.length > 0 && <span>Attended: {e.attended_by.join(", ")}</span>}
                      {also.length > 0 && <span>Also: {also.join(", ")}</span>}
                      {e.source_ref && <span>Source: {e.source_ref}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </section>

      {/* ── Appendix ── */}
      {appendix.length > 0 && (
        <section className="report-section page-break">
          <h2 className="section-title"><span>A</span> Appendix: source messages and photos</h2>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            Each item is an original file exactly as stored, with the events it supports. Download the ZIP for the
            original files named by these numbers.
          </p>
          {appendix.map((a) => {
            const url = urls.get(a.id) ?? null;
            const isImage = (a.mime_type ?? "").startsWith("image/");
            const text = texts.get(a.id);
            return (
              <div key={a.id} className="appendix-item">
                <div className="row between appendix-head">
                  <b>{a.ref}</b>
                  <span className="muted">Supports event{a.supports.length === 1 ? "" : "s"} {a.supports.join(", ")}</span>
                </div>
                <div style={{ fontSize: "0.88rem" }}>
                  {url ? <a href={url} target="_blank" rel="noreferrer">{a.filename}</a> : a.filename}
                </div>
                {isImage && url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt={a.filename} className="exhibit-img" />
                )}
                {text !== undefined && <pre className="chat-text">{text}</pre>}
                {!isImage && text === undefined &&
                  a.quotes.filter((q) => q.excerpt).map((q, i) => (
                    <div key={i} className="quote">“{q.excerpt}”{q.page_ref ? <span className="cite" style={{ display: "inline" }}> ({q.page_ref})</span> : null}</div>
                  ))}
                <div className="mono muted" style={{ fontSize: "0.68rem", wordBreak: "break-all" }}>SHA-256 {a.sha256}</div>
              </div>
            );
          })}
        </section>
      )}

      <p className="muted report-foot">
        Original files are stored write-once and fingerprinted (SHA-256) when uploaded. This report is a frozen snapshot;
        later edits in the journal do not change it.
      </p>
    </div>
  );
}
