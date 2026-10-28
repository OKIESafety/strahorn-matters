import { notFound } from "next/navigation";
import { requireMatter } from "@/lib/access";
import { formatDate, formatTimestamp } from "@/lib/format";
import { qrSvg, siteOrigin } from "@/lib/qr";
import { loadParents } from "@/lib/time-data";
import type { ExportItem } from "@/lib/report-data";
import { ExhibitBody } from "@/components/exhibit-body";
import { PrintButton } from "../../report/print-button";

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function ExportPage({ params }: { params: Promise<{ matterId: string; exportId: string }> }) {
  const { matterId, exportId } = await params;
  const { supabase, matter } = await requireMatter(matterId);
  const { data: ex } = await supabase
    .from("exports")
    .select("id, title, items, manifest_sha256, created_at, filters")
    .eq("id", exportId)
    .eq("matter_id", matterId)
    .maybeSingle();
  if (!ex) notFound();
  const items = ex.items as ExportItem[];
  const parents = await loadParents(supabase, matterId);

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
  const dates = items.map((i) => i.date).sort();

  return (
    <>
      <div className="no-print row between" style={{ marginBottom: 12 }}>
        <span className="muted">Exhibit packet</span>
        <PrintButton />
      </div>

      <section className="cover">
        <h1 style={{ fontSize: "1.8rem" }}>{ex.title}</h1>
        <p>{matter.title}</p>
        <dl className="kv" style={{ margin: "16px 0" }}>
          <dt>Prepared by</dt>
          <dd>{parents.set ? parents.a : "—"}</dd>
          <dt>Prepared on</dt>
          <dd>{formatTimestamp(ex.created_at)}</dd>
          <dt>Exhibits</dt>
          <dd>{items.length}</dd>
          {dates.length > 0 && (
            <>
              <dt>Period</dt>
              <dd>
                {formatDate(dates[0])} – {formatDate(dates[dates.length - 1])}
              </dd>
            </>
          )}
        </dl>
        <div className="verify-box">
          <div className="qr" dangerouslySetInnerHTML={{ __html: qr }} />
          <div>
            <b>Verify this packet</b>
            <div style={{ fontSize: "0.85rem", wordBreak: "break-all" }}>{verifyUrl}</div>
            <div className="mono" style={{ fontSize: "0.72rem", wordBreak: "break-all", marginTop: 6 }}>
              Packet fingerprint (SHA-256): {ex.manifest_sha256}
            </div>
            <small className="muted">
              Every attached file is listed with its SHA-256 fingerprint, recorded when the original was uploaded.
            </small>
          </div>
        </div>
      </section>

      <section className="card page-break">
        <h2>Index of exhibits</h2>
        <table className="simple">
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
    </>
  );
}
