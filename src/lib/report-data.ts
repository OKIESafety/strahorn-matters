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
  /** Issue or thread this event is filed under in the report (v3+). */
  group?: string;
  group_kind?: "thread" | "issue";
  threads?: string[];
  actor?: "a" | "b" | "other" | null;
  step?: string | null;
  source_ref: string | null;
  evidence: { id: string; filename: string; sha256: string; mime_type: string | null; excerpt: string | null; page_ref: string | null }[];
};

/**
 * Orders events for the report: grouped by issue (largest group first), chronological within each group,
 * then renumbered 1..N. An event in several issues is filed under the one with the most events.
 */
export function groupForReport(items: ExportItem[]): ExportItem[] {
  const OTHER = "Other events";
  const issueCount = new Map<string, number>();
  const threadCount = new Map<string, number>();
  for (const i of items) {
    for (const t of i.issues) issueCount.set(t, (issueCount.get(t) ?? 0) + 1);
    for (const t of i.threads ?? []) threadCount.set(t, (threadCount.get(t) ?? 0) + 1);
  }
  const top = (list: string[], counts: Map<string, number>) =>
    [...list].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b))[0];
  const withGroup = items.map((i) => {
    if (i.threads?.length) return { ...i, group: top(i.threads, threadCount), group_kind: "thread" as const };
    return { ...i, group: i.issues.length ? top(i.issues, issueCount) : OTHER, group_kind: "issue" as const };
  });
  const size = new Map<string, number>();
  for (const i of withGroup) size.set(i.group, (size.get(i.group) ?? 0) + 1);
  const rank = (i: { group: string; group_kind: string }) =>
    (i.group_kind === "thread" ? 1_000_000 : 0) + (i.group === OTHER ? -1 : size.get(i.group) ?? 0);
  withGroup.sort(
    (a, b) =>
      rank(b) - rank(a) ||
      a.group.localeCompare(b.group) ||
      a.date.localeCompare(b.date) ||
      (a.time ?? "").localeCompare(b.time ?? "")
  );
  return withGroup.map((i, n) => ({ ...i, exhibit: String(n + 1) }));
}

/** Appendix: each unique file, numbered A-1.. in the order events cite it, with the events it supports. */
export function buildAppendix(items: ExportItem[]) {
  const map = new Map<string, { ref: string; id: string; filename: string; sha256: string; mime_type: string | null; supports: string[]; quotes: { exhibit: string; excerpt: string | null; page_ref: string | null }[] }>();
  for (const i of items) {
    for (const v of i.evidence) {
      let a = map.get(v.id);
      if (!a) {
        a = { ref: `A-${map.size + 1}`, id: v.id, filename: v.filename, sha256: v.sha256, mime_type: v.mime_type, supports: [], quotes: [] };
        map.set(v.id, a);
      }
      if (!a.supports.includes(i.exhibit)) a.supports.push(i.exhibit);
      a.quotes.push({ exhibit: i.exhibit, excerpt: v.excerpt, page_ref: v.page_ref });
    }
  }
  return Array.from(map.values());
}

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
    threads: e.threads.map((t) => t.title),
    actor: e.actor,
    step: e.step,
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

/** JSON with object keys sorted at every level, so the database can't change the fingerprint by reordering fields. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : canonicalJson(x))).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// Packets made before v3 were fingerprinted with fields in the order they were built; the database stores JSON with
// its own key order, so rebuild that order to check them.
const pick = (o: any, keys: string[]) => {
  if (!o || typeof o !== "object") return o;
  const out: any = {};
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(o, k)) out[k] = o[k];
  return out;
};
const ITEM_KEYS = ["exhibit", "event_id", "date", "time", "title", "summary", "details", "people", "attended_by", "issues", "group", "source_ref", "evidence"];
const EV_KEYS = ["id", "filename", "sha256", "mime_type", "excerpt", "page_ref"];
const ORDER_KEYS = ["category", "title", "summary", "quote", "citation", "key_fact"];
const ab = (x: any) => pick(x, ["a", "b"]);
function legacyItems(items: any[]) {
  return items.map((i) => {
    const o = pick(i, ITEM_KEYS);
    if (Array.isArray(o.evidence)) o.evidence = o.evidence.map((v: any) => pick(v, EV_KEYS));
    return o;
  });
}
function legacyStats(s: any) {
  if (!s) return s;
  const fl = (a: any[]) => (a ?? []).map((x) => pick(x, ["label", "value"]));
  const p = s.parenting
    ? {
        ...pick(s.parenting, ["from", "to"]),
        parents: ab(s.parenting.parents),
        scheduled_pct: ab(s.parenting.scheduled_pct),
        actual_pct: ab(s.parenting.actual_pct),
        scheduled_hours: ab(s.parenting.scheduled_hours),
        actual_hours: ab(s.parenting.actual_hours),
        ...pick(s.parenting, ["late", "late_minutes", "no_show"]),
        late_by_month: fl(s.parenting.late_by_month),
      }
    : s.parenting;
  return {
    totals: pick(s.totals, ["events", "files"]),
    range: s.range ? pick(s.range, ["from", "to"]) : s.range,
    per_month: fl(s.per_month),
    per_issue: fl(s.per_issue),
    parenting: p,
  };
}

/**
 * Fingerprint of a report. v3+: canonical (sorted-key) JSON of exhibits, summary, order terms, charts and issue
 * summaries. v1 (exhibits only) and v2 (+ summary, terms, charts) use their original field order.
 */
export function manifestHash(
  items: ExportItem[],
  extra?: { summary: string | null; orders: unknown; stats: unknown; issue_summaries?: unknown },
  version: number = extra?.issue_summaries !== undefined ? 3 : extra ? 2 : 1
) {
  let text: string;
  if (version >= 3) {
    text = canonicalJson({
      items,
      summary: extra?.summary ?? null,
      orders: extra?.orders ?? null,
      stats: extra?.stats ?? null,
      issue_summaries: extra?.issue_summaries ?? null,
    });
  } else if (version === 2) {
    text = JSON.stringify({
      items: legacyItems(items as any[]),
      summary: extra?.summary ?? null,
      orders: ((extra?.orders as any[]) ?? []).map((o) => pick(o, ORDER_KEYS)),
      stats: legacyStats(extra?.stats),
    });
  } else {
    text = JSON.stringify(legacyItems(items as any[]));
  }
  return createHash("sha256").update(text).digest("hex");
}
