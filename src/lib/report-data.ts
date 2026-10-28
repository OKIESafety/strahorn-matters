import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadEvents, type EventFilters, type EventRow } from "./queries";

export type ReportEvidence = {
  id: string;
  filename: string;
  mime_type: string | null;
  kind: string;
  sha256: string;
  storage_path: string;
  excerpt: string | null;
  page_ref: string | null;
  url?: string | null;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Events meant for reports (never the ones marked "leave out"), oldest first, with their evidence. */
export async function loadReportData(db: SupabaseClient, matterId: string, f: EventFilters, opts: { signUrls?: boolean } = {}) {
  const { rows, total } = await loadEvents(db, matterId, f, { ascending: true, limit: 1000, reportOnly: true });
  const evByEvent = new Map<string, ReportEvidence[]>();
  const ids = rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db
      .from("event_evidence")
      .select("event_id, excerpt, page_ref, evidence(id, original_filename, mime_type, kind, sha256, storage_path)")
      .in("event_id", ids.slice(i, i + 200));
    for (const l of (data ?? []) as any[]) {
      if (!l.evidence) continue;
      const list = evByEvent.get(l.event_id) ?? [];
      list.push({
        id: l.evidence.id,
        filename: l.evidence.original_filename,
        mime_type: l.evidence.mime_type,
        kind: l.evidence.kind,
        sha256: l.evidence.sha256,
        storage_path: l.evidence.storage_path,
        excerpt: l.excerpt,
        page_ref: l.page_ref,
      });
      evByEvent.set(l.event_id, list);
    }
  }
  if (opts.signUrls) await signAll(db, Array.from(evByEvent.values()).flat());
  return { rows, total, evByEvent };
}

export async function signAll(db: SupabaseClient, items: { storage_path: string; url?: string | null }[]) {
  const paths = Array.from(new Set(items.map((e) => e.storage_path)));
  const urls = new Map<string, string>();
  for (let i = 0; i < paths.length; i += 100) {
    const { data } = await db.storage.from("evidence").createSignedUrls(paths.slice(i, i + 100), 3600);
    for (const s of data ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  for (const e of items) e.url = urls.get(e.storage_path) ?? null;
}

export type ExportItem = {
  exhibit: string;
  event_id: string;
  date: string;
  time: string | null;
  title: string;
  summary: string;
  details: string | null;
  people: string[];
  attended_by: string[];
  issues: string[];
  source_ref: string | null;
  evidence: { id: string; filename: string; sha256: string; mime_type: string | null; excerpt: string | null; page_ref: string | null }[];
};

/** Snapshot of events + evidence fingerprints for an exhibit packet. */
export function buildExportItems(rows: EventRow[], evByEvent: Map<string, ReportEvidence[]>): ExportItem[] {
  return rows.map((e, i) => ({
    exhibit: String(i + 1),
    event_id: e.id,
    date: e.event_date,
    time: e.event_time,
    title: e.title,
    summary: e.summary,
    details: e.details,
    people: e.people.map((p) => p.name),
    attended_by: e.attended_by,
    issues: e.issues.map((x) => x.title),
    source_ref: e.source_ref,
    evidence: (evByEvent.get(e.id) ?? []).map((v) => ({
      id: v.id,
      filename: v.filename,
      sha256: v.sha256,
      mime_type: v.mime_type,
      excerpt: v.excerpt,
      page_ref: v.page_ref,
    })),
  }));
}

/** Deterministic fingerprint of an export's contents. */
export function manifestHash(items: ExportItem[]) {
  return createHash("sha256").update(JSON.stringify(items)).digest("hex");
}
