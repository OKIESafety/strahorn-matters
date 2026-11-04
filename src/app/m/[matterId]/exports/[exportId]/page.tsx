import { notFound } from "next/navigation";
import { requireMatter } from "@/lib/access";
import { formatDate, formatTime, formatTimestamp } from "@/lib/format";
import { qrSvg, siteOrigin } from "@/lib/qr";
import { loadCase } from "@/lib/orders";
import { loadParents } from "@/lib/time-data";
import { buildAppendix, groupForReport, type ExportItem } from "@/lib/report-data";
import type { PacketStats } from "@/lib/packet";
import { ColumnChart, IssueTimeline, ShareCompare, StackedMonths, ThreadTimeline, issueColor } from "@/components/report-charts";
import { STEP_LABEL } from "@/lib/thread-stats";
import { todayLocal } from "@/lib/format";
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
  const byGroup = groupOrder.map((g) => {
    const its = items.filter((i) => (i.group ?? i.issues[0] ?? "Other events") === g);
    return { label: g, color: color.get(g)!, items: its, kind: its[0]?.group_kind ?? "issue" };
  });
  const threadStats = stats?.threads ?? [];
  const threadByTitle = new Map(threadStats.map((t) => [t.title, t]));
  const people = { a: parents.set ? parents.a : "Jonathan", b: parents.set ? parents.b : "Brandy" };
  const who = (a: string | null | undefined) => (a === "a" ? people.a : a === "b" ? people.b : null);
  const stepText = (e: ExportItem, g: string) => {
    if (!e.step) return null;
    const t = threadByTitle.get(g);
    const w = who(e.actor);
    if (e.step === "outcome") return "Outcome";
    if (t && e.actor === "a" && (e.step === "request" || e.step === "follow_up")) {
      const asks = t.steps.filter((x) => x.actor === "a" && (x.step === "request" || x.step === "follow_up"));
      const n = asks.findIndex((x) => x.exhibit === e.exhibit) + 1;
      if (n > 0) return `${w} ${n === 1 ? "asked" : "followed up"} · ${n} of ${asks.length}`;
    }
    return [w, STEP_LABEL[e.step] ?? e.step].filter(Boolean).join(" ");
  };
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
            Overview · Patterns · Follow-up tracker · Topics · Court order · Events by topic · Appendix of source messages and photos
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
          {threadStats.length > 0 && (
            <div><b>{threadStats.reduce((n, t) => n + t.asks, 0)}</b><span>requests &amp; follow-ups by {people.a}</span></div>
          )}
          {threadStats.some((t) => t.status === "open") && (
            <div><b>{threadStats.filter((t) => t.status === "open").length}</b><span>still waiting on an answer</span></div>
          )}
          {p && <div><b>{p.late}</b><span>late exchanges</span></div>}
          {p && <div><b>{p.actual_pct.a}%</b><span>actual time with {p.parents.a}</span></div>}
        </div>
        <table className="simple issue-table" style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th>Topic</th>
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

      {/* ── Follow-up tracker ── */}
      {threadStats.length > 0 && (
        <section className="report-section page-break">
          <h2 className="section-title"><span>{next()}</span> Follow-up tracker</h2>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            Each topic {people.a} raised, how many times he asked, how often {people.b} responded, and how long it took.
            <span className="key-inline">
              <span className="dot" style={{ background: "#2f5d50" }}>J</span> {people.a}
              <span className="dot" style={{ background: "#b08d57" }}>B</span> {people.b}
              <span className="dot sq" /> outcome
            </span>
          </p>
          {threadStats.map((t) => (
            <div key={t.title} className="thread-card">
              <div className="row between">
                <h3 style={{ margin: 0 }}>{t.title}</h3>
                <span className={`status ${t.status}`}>
                  {t.status === "resolved"
                    ? `Resolved ${t.resolved_on ? short(t.resolved_on) : ""}`
                    : t.waiting_since
                      ? `Still waiting since ${short(t.waiting_since)}`
                      : "Open"}
                </span>
              </div>
              {t.description && <div className="muted" style={{ fontSize: "0.88rem" }}>{t.description}</div>}
              <div className="stat-row">
                <div><b>{t.asks}</b><span>times {people.a} asked or followed up</span></div>
                <div><b>{t.replies}</b><span>responses from {people.b}</span></div>
                <div><b>{t.unanswered}</b><span>requests with no reply before the next</span></div>
                <div>
                  <b>{t.days_open}</b>
                  <span>{t.status === "resolved" ? "days from first request to resolution" : "days and counting"}</span>
                </div>
                {t.longest_wait > 0 && <div><b>{t.longest_wait}</b><span>days, longest wait for a reply</span></div>}
              </div>
              <ThreadTimeline
                steps={t.steps}
                end={t.status === "resolved" && t.resolved_on ? t.resolved_on : todayLocal()}
                open={t.status === "open"}
              />
              <div className="muted" style={{ fontSize: "0.78rem" }}>
                Events {t.steps.map((x) => x.exhibit).join(", ")} · full messages in the Appendix
              </div>
            </div>
          ))}
        </section>
      )}

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
        <h2 className="section-title"><span>{next()}</span> Events by topic</h2>
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          Related events are kept together and listed oldest to newest. “Proof” points to the source messages and photos in the Appendix.
        </p>
        {byGroup.map((g) => (
          <div key={g.label} className="event-group">
            <h3 className="group-head" style={{ borderLeftColor: g.color }}>
              {g.label} <span className="muted">· {g.items.length} event{g.items.length === 1 ? "" : "s"}</span>
            </h3>
            {g.kind === "thread" && threadByTitle.get(g.label) && (
              <div className="group-sub">
                {(() => {
                  const t = threadByTitle.get(g.label)!;
                  return `${people.a} asked or followed up ${t.asks} time${t.asks === 1 ? "" : "s"}; ${people.b} responded ${t.replies} time${t.replies === 1 ? "" : "s"}. ${
                    t.status === "resolved"
                      ? `Resolved ${t.resolved_on ? short(t.resolved_on) : ""} after ${t.days_open} days.`
                      : `Still open after ${t.days_open} days.`
                  }`;
                })()}
              </div>
            )}
            {g.items.map((e) => {
              const refs = Array.from(new Set(e.evidence.map((v) => refOf.get(v.id)).filter(Boolean)));
              const also = [...(e.threads ?? []), ...e.issues].filter((t) => t !== g.label);
              return (
                <div key={e.exhibit} className="event-row">
                  <div className="event-num" style={{ background: g.color }}>{e.exhibit}</div>
                  <div className="grow">
                    <div className="event-when">
                      {formatDate(e.date)}
                      {e.time ? ` · ${formatTime(e.time)}` : ""}
                      {stepText(e, g.label) && (
                        <span className={`step-chip ${e.actor ?? ""}`}>{stepText(e, g.label)}</span>
                      )}
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
