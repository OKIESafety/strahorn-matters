import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { sha256Hex } from "@/lib/core";
import { buildExportItems, loadReportData } from "@/lib/report-data";
import { readFilters } from "@/components/filters";
import { ExhibitBody } from "@/components/exhibit-body";
import { formatDate, formatTimestamp } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Shared records", robots: { index: false } };

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 20) notFound();
  const db = createAdminClient();
  const { data: link } = await db
    .from("share_links")
    .select("id, matter_id, label, filters, expires_at, revoked_at, view_count")
    .eq("token_hash", sha256Hex(Buffer.from(token)))
    .maybeSingle();
  if (!link || link.revoked_at || Date.parse(link.expires_at) < Date.now()) notFound();

  await db
    .from("share_links")
    .update({ last_viewed_at: new Date().toISOString(), view_count: (link.view_count ?? 0) + 1 })
    .eq("id", link.id);

  const { data: matter } = await db.from("matters").select("title").eq("id", link.matter_id).single();
  const f = readFilters(link.filters as Record<string, string>);
  const { rows, evByEvent } = await loadReportData(db, link.matter_id, f, { signUrls: true });
  const items = buildExportItems(rows, evByEvent);
  const urls = new Map<string, string | null>();
  for (const list of evByEvent.values()) for (const v of list) urls.set(v.id, v.url ?? null);
  let issueTitle: string | null = null;
  if (f.issue) {
    const { data } = await db.from("issues").select("title").eq("id", f.issue).maybeSingle();
    issueTitle = data?.title ?? null;
  }

  return (
    <main className="container" style={{ paddingTop: 24 }}>
      <h1>
        {matter?.title}
        {issueTitle ? ` — ${issueTitle}` : ""}
      </h1>
      <p className="muted" style={{ fontSize: "0.9rem" }}>
        Shared with {link.label} · read-only · link expires {formatTimestamp(link.expires_at)}
        {f.from || f.to ? ` · ${f.from ? formatDate(f.from) : "start"} – ${f.to ? formatDate(f.to) : "present"}` : ""}
        {" · "}
        {items.length} entries
      </p>
      <ExhibitBody items={items} urls={urls} pageBreaks={false} />
    </main>
  );
}
