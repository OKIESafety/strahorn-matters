import { notFound } from "next/navigation";
import { requireMatter } from "@/lib/access";
import { formatDate, formatTimestamp } from "@/lib/format";
import { qrSvg, siteOrigin } from "@/lib/qr";
import { loadCase } from "@/lib/orders";
import { loadParents } from "@/lib/time-data";
import type { ExportItem } from "@/lib/report-data";
import type { PacketStats } from "@/lib/packet";
import { ExhibitBody } from "@/components/exhibit-body";
import { BarList, ColumnChart, ShareCompare } from "@/components/report-charts";
import { PrintButton } from "../../report/print-button";

type OrderSnap = { category: string; title: string; summary: string; quote: string | null; citation: string | null; key_fact: boolean };

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function ExportPage({ params }: { params: Promise<{ matterId: string; exportId: string }> }) {
  const { matterId, exportId } = await params;
  const { supabase } = await requireMatter(matterId);
  const { data: ex } = await supabase
    .from("exports")
    .select("id, title, items, manifest_sha256, created_at, filters, summary, orders, stats, manifest_version")
    .eq("id", exportId)
    .eq("matter_id", matterId)
    .maybeSingle();
  if (!ex) notFound();
  const items = ex.items as ExportItem[];
  const orders = (ex.orders ?? []) as OrderSnap[];
  const stats = (ex.stats ?? null) as PacketStats | null;
  const [c, parents] = await Promise.all([loadCase(supabase, matterId), loadParents(supabase, matterId)]);

  const evIds = Array.from(new Set(items.flatMap((i) => i.evidence.map((v) => v.id))));
  const urls = new Map<string, string | null>();
  if (evIds.length) {
    const { data: ev } = await supabase.from("evidence").select("id, storage_path").in("id", evIds);
    const paths = (ev ?? []).map((e: any) => e.storage_path);
    const { data: signed } = await supabase.storage.from("evidence").createSignedUrls(paths, 3600);
    const byPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
    for (const e of (ev ?? []) as any[]) urls.set(e.id, byPath.get(e.storage_path) ?? null);
  }

  const verifyUrl = `${await siteOrigin()}/verify/${ex.id}`;
  const qr = await qrSvg(verifyUrl);
  const keyFacts = orders.filter((o) => o.key_fact && o.category !== "Case");
  const disputeTerms = orders.filter((o) => o.category === "Disputes & going back to court");
  const p = stats?.parenting ?? null;
  const range = stats?.range ?? null;

  return (
    <div className="packet">
      <div className="no-print row between" style={{ marginBottom: 12 }}>
        <span className="muted">Attorney report</span>
        <PrintButton />
      </div>

      {/* ── Cover ── */}
      <section className="cover-page">
        <div className="eyebrow">Prepared for counsel · Confidential</div>
        <h1 className="report-title">{ex.title}</h1>
        {c.caption && <div className="case-caption">{c.caption}</div>}
        <div className="muted">
          {[c.case_number && `Case No. ${c.case_number}`, c.court].filter(Boolean).join(" · ")}
        </div>
        <div className="cover-figures">
          <div><b>{items.length}</b><span>exhibits</span></div>
          <div><b>{stats?.totals.files ?? items.reduce((n, i) => n + i.evidence.length, 0)}</b><span>source files</span></div>
          {range && (
            <div>
              <b className="small">{formatDate(range.from).replace(/^\w+, /, "")}</b>
              <span>to {formatDate(range.to).replace(/^\w+, /, "")}</span>
            </div>
          )}
          {p && <div><b>{p.late}</b><span>late exchanges</span></div>}
        </div>
        <dl className="kv" style={{ marginTop: 18 }}>
          <dt>Prepared by</dt>
          <dd>{parents.set ? `${parents.a} Strahorn` : "—"}</dd>
          <dt>Prepared on</dt>
          <dd>{formatTimestamp(ex.created_at)}</dd>
        </dl>
        <div className="verify-box" style={{ marginTop: 20 }}>
          <div className="qr" dangerouslySetInnerHTML={{ __html: qr }} />
          <div>
            <b>Verify this report</b>
            <div style={{ fontSize: "0.85rem", wordBreak: "break-all" }}>{verifyUrl}</div>
            <div className="mono" style={{ fontSize: "0.7rem", wordBreak: "break-all", marginTop: 6 }}>
              Fingerprint (SHA-256): {ex.manifest_sha256}
            </div>
            <small className="muted">
              Scan to confirm this report and every attached file are unchanged since they were recorded.
            </small>
          </div>
        </div>
      </section>

      {/* ── Summary ── */}
      {ex.summary && (
        <section className="report-section page-break">
          <h2 className="section-title"><span>1</span> Summary</h2>
          <div className="summary-text">{ex.summary}</div>
        </section>
      )}

      {/* ── Court order ── */}
      {orders.length > 0 && (
        <section className="report-section page-break">
          <h2 className="section-title"><span>{ex.summary ? 2 : 1}</span> What the court order provides</h2>
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

      {/* ── Charts ── */}
      {stats && (
        <section className="report-section page-break">
          <h2 className="section-title">
            <span>{(ex.summary ? 1 : 0) + (orders.length ? 1 : 0) + 1}</span> The numbers
          </h2>
          {p && (
            <div className="chart-card">
              <h3>Parenting time: ordered vs actual</h3>
              <div className="muted chart-note">
                {formatDate(p.from)} – {formatDate(p.to)} · ordered schedule with agreed holiday changes, compared with
                recorded late and missed exchanges
              </div>
              <ShareCompare parents={p.parents} ordered={p.scheduled_pct} actual={p.actual_pct} />
              <div className="stat-row">
                <div><b>{Math.round(p.actual_hours.a)}</b><span>hours with {p.parents.a}</span></div>
                <div><b>{p.late}</b><span>late exchanges</span></div>
                <div><b>{p.late_minutes}</b><span>minutes late in total</span></div>
                <div><b>{p.no_show}</b><span>exchanges that didn&apos;t happen</span></div>
              </div>
              {p.late > 0 && (
                <>
                  <h4>Late exchanges by month</h4>
                  <ColumnChart data={p.late_by_month} color="#b4534b" label="Late exchanges by month" />
                </>
              )}
            </div>
          )}
          {stats.per_month.length > 1 && (
            <div className="chart-card">
              <h3>Documented events by month</h3>
              <ColumnChart data={stats.per_month} label="Documented events by month" />
            </div>
          )}
          {stats.per_issue.length > 0 && (
            <div className="chart-card">
              <h3>Events by issue</h3>
              <BarList data={stats.per_issue} />
            </div>
          )}
        </section>
      )}

      {/* ── Index ── */}
      <section className="report-section page-break">
        <h2 className="section-title"><span>{"§"}</span> Index of exhibits</h2>
        <table className="simple index-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Date</th>
              <th>Description</th>
              <th>Files</th>
            </tr>
          </thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.exhibit}>
                <td>{e.exhibit}</td>
                <td style={{ whiteSpace: "nowrap" }}>{formatDate(e.date)}</td>
                <td>{e.title}</td>
                <td>{e.evidence.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <ExhibitBody items={items} urls={urls} />

      <p className="muted report-foot">
        Original files are stored write-once and fingerprinted (SHA-256) when uploaded. This report is a frozen snapshot;
        later edits in the journal do not change it.
      </p>
    </div>
  );
}
