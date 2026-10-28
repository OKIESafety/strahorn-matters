import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type EventFilters = {
  q?: string;
  tag?: string;
  issue?: string;
  person?: string;
  from?: string;
  to?: string;
  confidence?: string;
};

export type EventRow = {
  id: string;
  event_date: string;
  event_time: string | null;
  title: string;
  summary: string;
  details: string | null;
  tags: string[];
  confidence: string;
  created_via: string;
  source_ref: string | null;
  issues: { id: string; title: string }[];
  people: { id: string; name: string }[];
  evidence_count: number;
};

export const EVENT_SELECT =
  "id, event_date, event_time, title, summary, details, tags, confidence, created_via, source_ref, event_issues(issues(id, title)), event_people(people(id, name)), event_evidence(count)";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function shapeEvent(r: any): EventRow {
  return {
    id: r.id,
    event_date: r.event_date,
    event_time: r.event_time,
    title: r.title,
    summary: r.summary,
    details: r.details,
    tags: r.tags ?? [],
    confidence: r.confidence,
    created_via: r.created_via,
    source_ref: r.source_ref,
    issues: (r.event_issues ?? []).map((x: any) => x.issues).filter(Boolean),
    people: (r.event_people ?? []).map((x: any) => x.people).filter(Boolean),
    evidence_count: r.event_evidence?.[0]?.count ?? 0,
  };
}

export async function loadEvents(
  db: SupabaseClient,
  matterId: string,
  f: EventFilters,
  opts: { limit?: number; offset?: number; ascending?: boolean } = {}
): Promise<{ rows: EventRow[]; total: number }> {
  let restrictIds: string[] | null = null;

  if (f.issue) {
    const { data } = await db.from("event_issues").select("event_id").eq("issue_id", f.issue);
    restrictIds = (data ?? []).map((r) => r.event_id);
  }
  if (f.person) {
    const { data } = await db.from("event_people").select("event_id").eq("person_id", f.person);
    const ids = (data ?? []).map((r) => r.event_id);
    restrictIds = restrictIds ? restrictIds.filter((i) => ids.includes(i)) : ids;
  }
  if (restrictIds && restrictIds.length === 0) return { rows: [], total: 0 };

  let query = db
    .from("events")
    .select(EVENT_SELECT, { count: "exact" })
    .eq("matter_id", matterId);

  if (restrictIds) query = query.in("id", restrictIds.slice(0, 1000));
  if (f.q?.trim()) query = query.textSearch("search", f.q.trim(), { type: "websearch", config: "english" });
  if (f.tag) query = query.contains("tags", [f.tag.toLowerCase()]);
  if (f.from) query = query.gte("event_date", f.from);
  if (f.to) query = query.lte("event_date", f.to);
  if (f.confidence) query = query.eq("confidence", f.confidence);

  const asc = opts.ascending ?? false;
  const limit = opts.limit ?? 500;
  const offset = opts.offset ?? 0;
  query = query
    .order("event_date", { ascending: asc })
    .order("event_time", { ascending: asc, nullsFirst: asc })
    .range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  return { rows: ((data ?? []) as any[]).map(shapeEvent), total: count ?? 0 };
}

export async function loadFilterOptions(db: SupabaseClient, matterId: string) {
  const [{ data: issues }, { data: people }, { data: tagRows }] = await Promise.all([
    db.from("issues").select("id, title").eq("matter_id", matterId).order("title"),
    db.from("people").select("id, name, relationship").eq("matter_id", matterId).order("name"),
    db.from("events").select("tags").eq("matter_id", matterId).limit(5000),
  ]);
  const tagCounts = new Map<string, number>();
  for (const r of tagRows ?? []) for (const t of (r.tags as string[]) ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  const tags = Array.from(tagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => ({ tag, count }));
  return { issues: issues ?? [], people: people ?? [], tags };
}
