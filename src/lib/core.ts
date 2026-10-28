import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Confidence, EvidenceKind } from "./constants";

/** Shared write logic used by both the web app and the AI connector. */

export type Actor = { userId: string; via: "app" | "ai" };

export type EventInput = {
  date: string; // YYYY-MM-DD
  time?: string | null; // HH:MM (24h, Central time)
  title: string;
  summary: string;
  details?: string | null;
  tags?: string[];
  issues?: string[]; // issue titles; created if missing
  people?: string[]; // person names; created if missing
  confidence?: Confidence;
  source_ref?: string | null;
  source_key?: string | null;
  attended_by?: string[];
  exclude_from_reports?: boolean;
  evidence?: { evidence_id: string; excerpt?: string | null; page_ref?: string | null }[];
};

export type CreateResult =
  | { index: number; status: "created"; event_id: string; title: string; possible_duplicates?: Dup[] }
  | { index: number; status: "skipped_existing"; event_id: string; title: string; reason: string }
  | { index: number; status: "skipped_possible_duplicate"; title: string; possible_duplicates: Dup[] }
  | { index: number; status: "error"; title: string; error: string };

type Dup = { id: string; event_date: string; title: string; score: number };

export function sha256Hex(buf: Buffer | Uint8Array) {
  return createHash("sha256").update(buf).digest("hex");
}

export function normalizeTags(tags: string[] | undefined | null) {
  return Array.from(
    new Set((tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))
  ).slice(0, 25);
}

export function normalizeTime(t: string | null | undefined) {
  if (!t) return null;
  const m = t.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = m[3]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function isValidDate(d: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + "T12:00:00Z"));
}

export async function ensureIssues(
  db: SupabaseClient,
  matterId: string,
  titles: string[],
  actor: Actor
) {
  const map = new Map<string, string>();
  const wanted = Array.from(new Set(titles.map((t) => t.trim()).filter(Boolean)));
  if (!wanted.length) return map;

  const { data: existing, error } = await db
    .from("issues")
    .select("id, title")
    .eq("matter_id", matterId);
  if (error) throw new Error(error.message);
  for (const i of existing ?? []) map.set(i.title.toLowerCase(), i.id);

  for (const title of wanted) {
    if (map.has(title.toLowerCase())) continue;
    const { data, error: insErr } = await db
      .from("issues")
      .insert({ matter_id: matterId, title, created_by: actor.userId, created_via: actor.via })
      .select("id")
      .single();
    if (insErr) throw new Error(`Could not create issue "${title}": ${insErr.message}`);
    map.set(title.toLowerCase(), data.id);
  }
  return map;
}

export async function ensurePeople(db: SupabaseClient, matterId: string, names: string[]) {
  const map = new Map<string, string>();
  const wanted = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
  if (!wanted.length) return map;

  const { data: existing, error } = await db
    .from("people")
    .select("id, name")
    .eq("matter_id", matterId);
  if (error) throw new Error(error.message);
  for (const p of existing ?? []) map.set(p.name.toLowerCase(), p.id);

  for (const name of wanted) {
    if (map.has(name.toLowerCase())) continue;
    const { data, error: insErr } = await db
      .from("people")
      .insert({ matter_id: matterId, name })
      .select("id")
      .single();
    if (insErr) throw new Error(`Could not add person "${name}": ${insErr.message}`);
    map.set(name.toLowerCase(), data.id);
  }
  return map;
}

export async function findSimilar(
  db: SupabaseClient,
  matterId: string,
  date: string,
  text: string
): Promise<Dup[]> {
  const { data, error } = await db.rpc("similar_events", {
    p_matter: matterId,
    p_date: date,
    p_text: text,
    p_days: 1,
  });
  if (error) return [];
  return (data ?? []) as Dup[];
}

/**
 * Creates events in a batch.
 * onDuplicate: "skip" (default) leaves out likely duplicates and reports them,
 *              "flag" creates them but reports the matches,
 *              "create" creates without checking similarity.
 * An event whose source_key already exists is always skipped.
 */
export async function createEvents(
  db: SupabaseClient,
  matterId: string,
  inputs: EventInput[],
  actor: Actor,
  onDuplicate: "skip" | "flag" | "create" = "skip"
): Promise<CreateResult[]> {
  const issueMap = await ensureIssues(
    db,
    matterId,
    inputs.flatMap((e) => e.issues ?? []),
    actor
  );
  const peopleMap = await ensurePeople(
    db,
    matterId,
    inputs.flatMap((e) => e.people ?? [])
  );

  const results: CreateResult[] = [];

  for (let index = 0; index < inputs.length; index++) {
    const e = inputs[index];
    const title = (e.title ?? "").trim().slice(0, 300);
    try {
      if (!isValidDate(e.date)) throw new Error(`Invalid date "${e.date}" (use YYYY-MM-DD)`);
      if (!title) throw new Error("Title is required");

      const sourceKey = e.source_key?.trim() || null;
      if (sourceKey) {
        const { data: existing } = await db
          .from("events")
          .select("id")
          .eq("matter_id", matterId)
          .eq("source_key", sourceKey)
          .maybeSingle();
        if (existing) {
          results.push({
            index,
            status: "skipped_existing",
            event_id: existing.id,
            title,
            reason: "An event with this source_key already exists",
          });
          continue;
        }
      }

      let dups: Dup[] = [];
      if (onDuplicate !== "create") {
        dups = (await findSimilar(db, matterId, e.date, `${title} ${e.summary ?? ""}`)).filter(
          (d) => d.score >= 0.45
        );
        if (dups.length && onDuplicate === "skip") {
          results.push({ index, status: "skipped_possible_duplicate", title, possible_duplicates: dups });
          continue;
        }
      }

      const { data: ev, error } = await db
        .from("events")
        .insert({
          matter_id: matterId,
          event_date: e.date,
          event_time: normalizeTime(e.time),
          title,
          summary: (e.summary ?? "").trim(),
          details: e.details?.trim() || null,
          tags: normalizeTags(e.tags),
          confidence: e.confidence ?? (actor.via === "ai" ? "needs_review" : "reported"),
          source_ref: e.source_ref?.trim() || null,
          source_key: sourceKey,
          attended_by: (e.attended_by ?? []).map((n) => n.trim()).filter(Boolean).slice(0, 20),
          exclude_from_reports: !!e.exclude_from_reports,
          created_by: actor.userId,
          created_via: actor.via,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);

      const issueIds = (e.issues ?? [])
        .map((t) => issueMap.get(t.trim().toLowerCase()))
        .filter(Boolean) as string[];
      if (issueIds.length) {
        const { error: jiErr } = await db
          .from("event_issues")
          .insert(Array.from(new Set(issueIds)).map((issue_id) => ({ event_id: ev.id, issue_id })));
        if (jiErr) throw new Error(`Event created but issue link failed: ${jiErr.message}`);
      }

      const personIds = (e.people ?? [])
        .map((n) => peopleMap.get(n.trim().toLowerCase()))
        .filter(Boolean) as string[];
      if (personIds.length) {
        const { error: jpErr } = await db
          .from("event_people")
          .insert(Array.from(new Set(personIds)).map((person_id) => ({ event_id: ev.id, person_id })));
        if (jpErr) throw new Error(`Event created but people link failed: ${jpErr.message}`);
      }

      if (e.evidence?.length) {
        await attachEvidence(db, matterId, ev.id, e.evidence);
      }

      results.push({
        index,
        status: "created",
        event_id: ev.id,
        title,
        ...(dups.length ? { possible_duplicates: dups } : {}),
      });
    } catch (err) {
      results.push({ index, status: "error", title, error: (err as Error).message });
    }
  }
  return results;
}

export async function attachEvidence(
  db: SupabaseClient,
  matterId: string,
  eventId: string,
  items: { evidence_id: string; excerpt?: string | null; page_ref?: string | null }[]
) {
  const ids = items.map((i) => i.evidence_id);
  const { data: ev, error } = await db
    .from("evidence")
    .select("id")
    .eq("matter_id", matterId)
    .in("id", ids);
  if (error) throw new Error(error.message);
  const valid = new Set((ev ?? []).map((r) => r.id));
  const missing = ids.filter((id) => !valid.has(id));
  if (missing.length) throw new Error(`Evidence not found in this matter: ${missing.join(", ")}`);

  const { error: insErr } = await db.from("event_evidence").upsert(
    items.map((i) => ({
      event_id: eventId,
      evidence_id: i.evidence_id,
      excerpt: i.excerpt?.trim() || null,
      page_ref: i.page_ref?.trim() || null,
    })),
    { onConflict: "event_id,evidence_id", ignoreDuplicates: true }
  );
  if (insErr) throw new Error(insErr.message);
}

export function guessKind(mime: string | null | undefined, filename: string): EvidenceKind {
  const f = filename.toLowerCase();
  const m = (mime ?? "").toLowerCase();
  if (/\.(csv|tsv|txt|xlsx|xls)$/.test(f) || m.includes("csv")) return "text_export";
  if (f.startsWith("screenshot") || f.startsWith("img_") && m === "image/png") return "screenshot";
  if (m.startsWith("image/")) return "photo";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("video/")) return "video";
  if (/\.(eml|msg)$/.test(f)) return "email";
  if (m === "application/pdf" || /\.(pdf|docx?|rtf)$/.test(f)) return "document";
  return "other";
}

export function safeFilename(name: string) {
  const cleaned = name.replace(/[^\w.\- ()]+/g, "_").replace(/\s+/g, " ").trim();
  return cleaned.slice(-120) || "file";
}

export function newStoragePath(matterId: string, filename: string) {
  return `${matterId}/${randomUUID()}/${safeFilename(filename)}`;
}

/** Stores bytes in the evidence bucket and records the immutable evidence row. */
export async function storeEvidence(
  db: SupabaseClient,
  args: {
    matterId: string;
    filename: string;
    mimeType: string;
    bytes: Buffer;
    kind?: EvidenceKind;
    description?: string | null;
    sourceDate?: string | null;
    actor: Actor;
  }
) {
  const path = newStoragePath(args.matterId, args.filename);
  const { error: upErr } = await db.storage
    .from("evidence")
    .upload(path, args.bytes, { contentType: args.mimeType, upsert: false });
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
  return recordEvidence(db, {
    matterId: args.matterId,
    storagePath: path,
    filename: args.filename,
    mimeType: args.mimeType,
    size: args.bytes.length,
    sha256: sha256Hex(args.bytes),
    kind: args.kind ?? guessKind(args.mimeType, args.filename),
    description: args.description ?? null,
    sourceDate: args.sourceDate ?? null,
    actor: args.actor,
  });
}

export async function recordEvidence(
  db: SupabaseClient,
  a: {
    matterId: string;
    storagePath: string;
    filename: string;
    mimeType: string | null;
    size: number;
    sha256: string;
    kind: EvidenceKind;
    description: string | null;
    sourceDate: string | null;
    actor: Actor;
  }
) {
  const { data, error } = await db
    .from("evidence")
    .insert({
      matter_id: a.matterId,
      storage_path: a.storagePath,
      original_filename: a.filename,
      mime_type: a.mimeType,
      size_bytes: a.size,
      sha256: a.sha256,
      kind: a.kind,
      description: a.description,
      source_date: a.sourceDate && isValidDate(a.sourceDate) ? a.sourceDate : null,
      uploaded_by: a.actor.userId,
      uploaded_via: a.actor.via,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}
