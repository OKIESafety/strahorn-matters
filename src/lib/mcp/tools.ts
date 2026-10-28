import "server-only";
import { z } from "zod";
import type { createMcpHandler } from "mcp-handler";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CONFIDENCE_VALUES, EVIDENCE_KINDS, type EvidenceKind } from "@/lib/constants";
import {
  attachEvidence,
  createEvents,
  ensureIssues,
  ensurePeople,
  guessKind,
  isValidDate,
  normalizeTags,
  normalizeTime,
  storeEvidence,
} from "@/lib/core";
import { EVENT_SELECT, loadEvents, shapeEvent } from "@/lib/queries";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const SERVER_INSTRUCTIONS = `Strahorn Matters is a private evidence journal for a family-law (custody) matter.
Hierarchy: Matter -> Issue -> Event -> Evidence. Call list_matters first to get the matter_id.

Rules for writing records:
- Events must be factual and neutral: who, what, when. No opinions, insults, or legal conclusions.
- Use the exact date (YYYY-MM-DD) and Central-time clock time when known.
- Quote the supporting text exactly in evidence excerpts; never paraphrase inside a quote.
- Set confidence honestly: "confirmed" only when the other party's own message or a document directly shows it;
  use "needs_review" when you are inferring or unsure. Never upgrade an allegation into a fact.
- Always give source_ref (e.g. "iMazing export 2026-10-27, row 4123" or "texts PDF p. 684") and a stable
  source_key (e.g. "imazing:2026-04-10T21:12:brandy") so re-processing the same export never creates duplicates.
- Before adding many events, call search_events for the date range to see what already exists.
- create_events skips likely duplicates by default and tells you which; report those to the user instead of forcing them.
- Text exports uploaded in the app appear in list_evidence with kind "text_export"; read them with read_evidence_text
  in chunks, then link events to that evidence_id with an excerpt and page_ref (row/line number).
- To save an original file (PDF, screenshot, photo) that exists in the conversation, use upload_evidence_file
  (passes the file by reference, up to 45 MB) instead of base64 in upload_evidence.
- Original evidence can never be edited or deleted. After writing, tell the user what you created and what you skipped.`;

type Ctx = { db: SupabaseClient; userId: string };
type McpServer = Parameters<Parameters<typeof createMcpHandler>[0]>[0];

const ok = (obj: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(obj, null, 1) }] });
const fail = (msg: string) => ({ isError: true, content: [{ type: "text" as const, text: `Error: ${msg}` }] });

async function role(ctx: Ctx, matterId: string): Promise<string | null> {
  const { data } = await ctx.db
    .from("matter_members")
    .select("role")
    .eq("matter_id", matterId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  return data?.role ?? null;
}

async function requireRead(ctx: Ctx, matterId: string) {
  const r = await role(ctx, matterId);
  if (!r) throw new Error("Matter not found or no access");
  return r;
}

async function requireWrite(ctx: Ctx, matterId: string) {
  const r = await requireRead(ctx, matterId);
  if (r !== "owner" && r !== "contributor") throw new Error("Read-only access to this matter");
  return r;
}

async function eventMatter(ctx: Ctx, eventId: string) {
  const { data } = await ctx.db.from("events").select("matter_id").eq("id", eventId).maybeSingle();
  if (!data) throw new Error(`Event ${eventId} not found`);
  return data.matter_id as string;
}

const MAX_FETCH_BYTES = 45 * 1024 * 1024;

/** Downloads a file by https URL with a size cap. Refuses local/private hosts. */
async function fetchFile(rawUrl: string) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") throw new Error("Only https links are accepted");
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^(\d{1,3}\.){3}\d{1,3}$/.test(host) ||
    host.includes(":")
  ) {
    throw new Error("That address isn't allowed");
  }
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(40_000) });
  if (!res.ok || !res.body) throw new Error(`Couldn't download the file (HTTP ${res.status})`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_FETCH_BYTES) throw new Error("File is over 45 MB; upload it in the app instead");

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_FETCH_BYTES) {
      await reader.cancel();
      throw new Error("File is over 45 MB; upload it in the app instead");
    }
    chunks.push(value);
  }
  const cd = res.headers.get("content-disposition") ?? "";
  const cdName = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1];
  const pathName = decodeURIComponent(url.pathname.split("/").pop() ?? "");
  return {
    bytes: Buffer.concat(chunks.map((c) => Buffer.from(c))),
    contentType: (res.headers.get("content-type") ?? "").split(";")[0].trim() || null,
    nameFromUrl: (cdName ? decodeURIComponent(cdName) : pathName) || null,
  };
}

function wrap<A>(fn: (args: A) => Promise<any>) {
  return async (args: A) => {
    try {
      return await fn(args);
    } catch (e) {
      return fail((e as Error).message);
    }
  };
}

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const confidence = z.enum(CONFIDENCE_VALUES);

const eventShape = z.object({
  date: dateStr.describe("Date the incident happened, YYYY-MM-DD"),
  time: z.string().optional().nullable().describe("Local Central time, e.g. 21:12 or 9:12 PM"),
  title: z.string().min(1).max(300).describe("Short neutral title, e.g. 'Pickup 23 minutes late'"),
  summary: z.string().describe("1-3 factual sentences"),
  details: z.string().optional().nullable().describe("Optional longer narrative or context"),
  tags: z.array(z.string()).optional().describe("Lowercase tags, e.g. ['late exchange']"),
  issues: z.array(z.string()).optional().describe("Issue titles to file under; missing issues are created"),
  people: z.array(z.string()).optional().describe("Names involved; missing people are created"),
  confidence: confidence.optional().describe("Defaults to needs_review for AI-created events"),
  source_ref: z.string().optional().nullable().describe("Human-readable pointer to the source"),
  source_key: z.string().optional().nullable().describe("Stable unique key for this incident from this source; prevents duplicates"),
  evidence: z
    .array(
      z.object({
        evidence_id: z.string().uuid(),
        excerpt: z.string().optional().nullable().describe("Exact quote supporting the event"),
        page_ref: z.string().optional().nullable().describe("Row, line, page or timestamp"),
      })
    )
    .optional(),
});

export function registerTools(server: McpServer, ctx: Ctx) {
  server.tool(
    "list_matters",
    "List the matters you can access, with your role and counts.",
    wrap(async (_: unknown) => {
      const { data, error } = await ctx.db
        .from("matter_members")
        .select("role, matters(id, title, description)")
        .eq("user_id", ctx.userId);
      if (error) throw new Error(error.message);
      const out = [];
      for (const m of (data ?? []) as any[]) {
        if (!m.matters) continue;
        const { count } = await ctx.db
          .from("events")
          .select("id", { count: "exact", head: true })
          .eq("matter_id", m.matters.id);
        out.push({ ...m.matters, role: m.role, event_count: count ?? 0 });
      }
      return ok(out);
    })
  );

  server.tool(
    "get_matter",
    "Overview of a matter: issues (with event counts), people, tags in use, date range, and items needing review.",
    { matter_id: z.string().uuid() },
    wrap(async ({ matter_id }: { matter_id: string }) => {
      await requireRead(ctx, matter_id);
      const [m, issues, people, tags, first, last, review, evidence] = await Promise.all([
        ctx.db.from("matters").select("id, title, description").eq("id", matter_id).single(),
        ctx.db.from("issues").select("id, title, description, event_issues(count)").eq("matter_id", matter_id).order("title"),
        ctx.db.from("people").select("id, name, relationship").eq("matter_id", matter_id).order("name"),
        ctx.db.from("events").select("tags").eq("matter_id", matter_id).limit(5000),
        ctx.db.from("events").select("event_date").eq("matter_id", matter_id).order("event_date").limit(1),
        ctx.db.from("events").select("event_date").eq("matter_id", matter_id).order("event_date", { ascending: false }).limit(1),
        ctx.db.from("events").select("id", { count: "exact", head: true }).eq("matter_id", matter_id).eq("confidence", "needs_review"),
        ctx.db.from("evidence").select("id", { count: "exact", head: true }).eq("matter_id", matter_id),
      ]);
      const tagCounts: Record<string, number> = {};
      for (const r of (tags.data ?? []) as any[]) for (const t of r.tags ?? []) tagCounts[t] = (tagCounts[t] ?? 0) + 1;
      return ok({
        matter: m.data,
        issues: ((issues.data ?? []) as any[]).map((i) => ({
          id: i.id,
          title: i.title,
          description: i.description,
          event_count: i.event_issues?.[0]?.count ?? 0,
        })),
        people: people.data,
        tags: tagCounts,
        event_date_range: { first: first.data?.[0]?.event_date ?? null, last: last.data?.[0]?.event_date ?? null },
        needs_review_count: review.count ?? 0,
        evidence_count: evidence.count ?? 0,
      });
    })
  );

  server.tool(
    "search_events",
    "Search events. Combine any filters. Returns compact rows; use get_events for full detail and evidence.",
    {
      matter_id: z.string().uuid(),
      query: z.string().optional().describe("Full-text search, e.g. 'late pickup' or '\"home alone\"'"),
      tag: z.string().optional(),
      issue_id: z.string().uuid().optional(),
      person_id: z.string().uuid().optional(),
      date_from: dateStr.optional(),
      date_to: dateStr.optional(),
      confidence: confidence.optional(),
      limit: z.number().int().min(1).max(300).optional(),
      offset: z.number().int().min(0).optional(),
    },
    wrap(async (a: any) => {
      await requireRead(ctx, a.matter_id);
      const { rows, total } = await loadEvents(
        ctx.db,
        a.matter_id,
        {
          q: a.query,
          tag: a.tag,
          issue: a.issue_id,
          person: a.person_id,
          from: a.date_from,
          to: a.date_to,
          confidence: a.confidence,
        },
        { limit: a.limit ?? 100, offset: a.offset ?? 0, ascending: true }
      );
      return ok({
        total,
        returned: rows.length,
        events: rows.map((e) => ({
          id: e.id,
          date: e.event_date,
          time: e.event_time,
          title: e.title,
          summary: e.summary,
          tags: e.tags,
          issues: e.issues.map((i) => i.title),
          people: e.people.map((p) => p.name),
          confidence: e.confidence,
          evidence_count: e.evidence_count,
          source_ref: e.source_ref,
        })),
      });
    })
  );

  server.tool(
    "get_events",
    "Full detail for up to 50 events: text, people, issues, notes, and attached evidence with exact quotes and 1-hour view links.",
    { event_ids: z.array(z.string().uuid()).min(1).max(50) },
    wrap(async ({ event_ids }: { event_ids: string[] }) => {
      const { data, error } = await ctx.db
        .from("events")
        .select(`${EVENT_SELECT}, matter_id, source_key, created_at`)
        .in("id", event_ids);
      if (error) throw new Error(error.message);
      const out = [];
      for (const r of (data ?? []) as any[]) {
        if (!(await role(ctx, r.matter_id))) continue;
        const [{ data: links }, { data: notes }] = await Promise.all([
          ctx.db
            .from("event_evidence")
            .select("excerpt, page_ref, evidence(id, storage_path, original_filename, kind, mime_type, sha256, description)")
            .eq("event_id", r.id),
          ctx.db.from("notes").select("body, author_kind, created_at").eq("event_id", r.id).order("created_at"),
        ]);
        const evidence = [];
        for (const l of (links ?? []) as any[]) {
          if (!l.evidence) continue;
          const { data: s } = await ctx.db.storage.from("evidence").createSignedUrl(l.evidence.storage_path, 3600);
          evidence.push({
            evidence_id: l.evidence.id,
            filename: l.evidence.original_filename,
            kind: l.evidence.kind,
            description: l.evidence.description,
            excerpt: l.excerpt,
            page_ref: l.page_ref,
            sha256: l.evidence.sha256,
            view_url: s?.signedUrl ?? null,
          });
        }
        const e = shapeEvent(r);
        out.push({
          id: e.id,
          matter_id: r.matter_id,
          date: e.event_date,
          time: e.event_time,
          title: e.title,
          summary: e.summary,
          details: e.details,
          tags: e.tags,
          issues: e.issues,
          people: e.people,
          confidence: e.confidence,
          source_ref: e.source_ref,
          source_key: r.source_key,
          created_via: e.created_via,
          created_at: r.created_at,
          evidence,
          notes,
        });
      }
      return ok(out);
    })
  );

  server.tool(
    "create_issue",
    "Create an issue (a theme that groups events, e.g. 'Late exchanges'). Returns the existing one if the title already exists.",
    {
      matter_id: z.string().uuid(),
      title: z.string().min(1).max(200),
      description: z.string().optional(),
    },
    wrap(async (a: { matter_id: string; title: string; description?: string }) => {
      await requireWrite(ctx, a.matter_id);
      const map = await ensureIssues(ctx.db, a.matter_id, [a.title], { userId: ctx.userId, via: "ai" });
      const id = map.get(a.title.trim().toLowerCase())!;
      if (a.description) await ctx.db.from("issues").update({ description: a.description }).eq("id", id);
      return ok({ issue_id: id, title: a.title.trim() });
    })
  );

  server.tool(
    "create_events",
    "Create up to 100 events in one call, optionally filing them under issues (created if missing) and linking evidence. " +
      "Likely duplicates (same source_key, or very similar title on the same/adjacent day) are skipped by default and reported.",
    {
      matter_id: z.string().uuid(),
      events: z.array(eventShape).min(1).max(100),
      on_duplicate: z
        .enum(["skip", "flag", "create"])
        .optional()
        .describe("skip (default): leave out likely duplicates; flag: create but report matches; create: no similarity check"),
    },
    wrap(async (a: any) => {
      await requireWrite(ctx, a.matter_id);
      const results = await createEvents(ctx.db, a.matter_id, a.events, { userId: ctx.userId, via: "ai" }, a.on_duplicate ?? "skip");
      const summary = {
        created: results.filter((r) => r.status === "created").length,
        skipped_existing: results.filter((r) => r.status === "skipped_existing").length,
        skipped_possible_duplicate: results.filter((r) => r.status === "skipped_possible_duplicate").length,
        errors: results.filter((r) => r.status === "error").length,
      };
      return ok({ summary, results });
    })
  );

  server.tool(
    "update_event",
    "Update an event's fields, tags, issues or people. Every change is recorded in the audit log.",
    {
      event_id: z.string().uuid(),
      title: z.string().optional(),
      summary: z.string().optional(),
      details: z.string().optional().nullable(),
      date: dateStr.optional(),
      time: z.string().optional().nullable(),
      confidence: confidence.optional(),
      source_ref: z.string().optional().nullable(),
      add_tags: z.array(z.string()).optional(),
      remove_tags: z.array(z.string()).optional(),
      add_issues: z.array(z.string()).optional().describe("Issue titles; created if missing"),
      remove_issues: z.array(z.string()).optional().describe("Issue titles"),
      add_people: z.array(z.string()).optional(),
    },
    wrap(async (a: any) => {
      const matterId = await eventMatter(ctx, a.event_id);
      await requireWrite(ctx, matterId);
      const { data: cur } = await ctx.db.from("events").select("tags").eq("id", a.event_id).single();
      const patch: Record<string, unknown> = { updated_by: ctx.userId };
      if (a.title !== undefined) patch.title = a.title;
      if (a.summary !== undefined) patch.summary = a.summary;
      if (a.details !== undefined) patch.details = a.details;
      if (a.date !== undefined) {
        if (!isValidDate(a.date)) throw new Error("Invalid date");
        patch.event_date = a.date;
      }
      if (a.time !== undefined) patch.event_time = normalizeTime(a.time);
      if (a.confidence !== undefined) patch.confidence = a.confidence;
      if (a.source_ref !== undefined) patch.source_ref = a.source_ref;
      if (a.add_tags || a.remove_tags) {
        const remove = new Set(normalizeTags(a.remove_tags));
        patch.tags = normalizeTags([...(cur?.tags ?? []), ...(a.add_tags ?? [])]).filter((t) => !remove.has(t));
      }
      const { error } = await ctx.db.from("events").update(patch).eq("id", a.event_id);
      if (error) throw new Error(error.message);

      if (a.add_issues?.length) {
        const map = await ensureIssues(ctx.db, matterId, a.add_issues, { userId: ctx.userId, via: "ai" });
        const rows = a.add_issues.map((t: string) => ({ event_id: a.event_id, issue_id: map.get(t.trim().toLowerCase()) }));
        await ctx.db.from("event_issues").upsert(rows, { onConflict: "event_id,issue_id", ignoreDuplicates: true });
      }
      if (a.remove_issues?.length) {
        const { data: iss } = await ctx.db.from("issues").select("id, title").eq("matter_id", matterId);
        const lower = new Set(a.remove_issues.map((t: string) => t.trim().toLowerCase()));
        const ids = (iss ?? []).filter((i) => lower.has(i.title.toLowerCase())).map((i) => i.id);
        if (ids.length) await ctx.db.from("event_issues").delete().eq("event_id", a.event_id).in("issue_id", ids);
      }
      if (a.add_people?.length) {
        const map = await ensurePeople(ctx.db, matterId, a.add_people);
        const rows = a.add_people.map((n: string) => ({ event_id: a.event_id, person_id: map.get(n.trim().toLowerCase()) }));
        await ctx.db.from("event_people").upsert(rows, { onConflict: "event_id,person_id", ignoreDuplicates: true });
      }
      return ok({ updated: a.event_id });
    })
  );

  server.tool(
    "add_note",
    "Add an append-only note to an event or issue (e.g. analysis, follow-up needed). Notes can't be edited later.",
    {
      matter_id: z.string().uuid(),
      body: z.string().min(1),
      event_id: z.string().uuid().optional(),
      issue_id: z.string().uuid().optional(),
    },
    wrap(async (a: any) => {
      await requireWrite(ctx, a.matter_id);
      const { data, error } = await ctx.db
        .from("notes")
        .insert({
          matter_id: a.matter_id,
          event_id: a.event_id ?? null,
          issue_id: a.issue_id ?? null,
          body: a.body,
          author: ctx.userId,
          author_kind: "ai",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return ok({ note_id: data.id });
    })
  );

  server.tool(
    "list_evidence",
    "List evidence files in a matter (newest first). Text exports the user uploaded have kind 'text_export'.",
    {
      matter_id: z.string().uuid(),
      kind: z.enum(EVIDENCE_KINDS).optional(),
      filename_contains: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
    wrap(async (a: any) => {
      await requireRead(ctx, a.matter_id);
      let q = ctx.db
        .from("evidence")
        .select("id, original_filename, kind, mime_type, size_bytes, description, source_date, uploaded_at, uploaded_via, event_evidence(count)")
        .eq("matter_id", a.matter_id)
        .order("uploaded_at", { ascending: false })
        .limit(a.limit ?? 50);
      if (a.kind) q = q.eq("kind", a.kind);
      if (a.filename_contains) q = q.ilike("original_filename", `%${a.filename_contains}%`);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return ok(
        ((data ?? []) as any[]).map((e) => ({
          evidence_id: e.id,
          filename: e.original_filename,
          kind: e.kind,
          mime_type: e.mime_type,
          size_bytes: e.size_bytes,
          description: e.description,
          source_date: e.source_date,
          uploaded_at: e.uploaded_at,
          uploaded_via: e.uploaded_via,
          linked_events: e.event_evidence?.[0]?.count ?? 0,
        }))
      );
    })
  );

  server.tool(
    "read_evidence_text",
    "Read a text-based evidence file (CSV, TXT, JSON) in chunks of lines. Line 1 is the header for CSVs. " +
      "Use start_line/max_lines to page through large exports; cite line numbers as page_ref.",
    {
      evidence_id: z.string().uuid(),
      start_line: z.number().int().min(1).optional(),
      max_lines: z.number().int().min(1).max(2000).optional(),
      contains: z.string().optional().describe("Only return lines containing this text (case-insensitive)"),
    },
    wrap(async (a: any) => {
      const { data: ev } = await ctx.db
        .from("evidence")
        .select("id, matter_id, storage_path, original_filename, mime_type")
        .eq("id", a.evidence_id)
        .maybeSingle();
      if (!ev) throw new Error("Evidence not found");
      await requireRead(ctx, ev.matter_id);
      const textual =
        /\.(csv|tsv|txt|json|md|eml)$/i.test(ev.original_filename) ||
        (ev.mime_type ?? "").startsWith("text/") ||
        ev.mime_type === "application/json";
      if (!textual) {
        throw new Error(
          `${ev.original_filename} isn't a text file. For iMazing, export as CSV; for images, use the view_url from get_events.`
        );
      }
      const { data, error } = await ctx.db.storage.from("evidence").download(ev.storage_path);
      if (error || !data) throw new Error("Could not read file");
      const lines = (await data.text()).split(/\r?\n/);
      const start = a.start_line ?? 1;
      const max = a.max_lines ?? 400;
      let selected: { n: number; text: string }[];
      if (a.contains) {
        const needle = a.contains.toLowerCase();
        selected = lines
          .map((text, i) => ({ n: i + 1, text }))
          .filter((l) => l.n >= start && l.text.toLowerCase().includes(needle))
          .slice(0, max);
      } else {
        selected = lines.slice(start - 1, start - 1 + max).map((text, i) => ({ n: start + i, text }));
      }
      const lastShown = selected.length ? selected[selected.length - 1].n : start - 1;
      return ok({
        filename: ev.original_filename,
        total_lines: lines.length,
        header: lines[0],
        returned_lines: selected.length,
        next_start_line: !a.contains && lastShown < lines.length ? lastShown + 1 : null,
        text: selected.map((l) => `${l.n}\t${l.text}`).join("\n"),
      });
    })
  );

  server.tool(
    "upload_evidence",
    "Store a new evidence file (base64, or plain text for text content). Max ~8 MB. Optionally link to events. " +
      "For files that exist in the conversation (PDFs, screenshots), use upload_evidence_file instead.",
    {
      matter_id: z.string().uuid(),
      filename: z.string().min(1),
      mime_type: z.string().optional(),
      content_base64: z.string().optional(),
      text_content: z.string().optional(),
      kind: z.enum(EVIDENCE_KINDS).optional(),
      description: z.string().optional(),
      source_date: dateStr.optional(),
      link_to_event_ids: z.array(z.string().uuid()).optional(),
    },
    wrap(async (a: any) => {
      await requireWrite(ctx, a.matter_id);
      let bytes: Buffer;
      if (a.content_base64) bytes = Buffer.from(a.content_base64, "base64");
      else if (a.text_content !== undefined) bytes = Buffer.from(a.text_content, "utf8");
      else throw new Error("Provide content_base64 or text_content");
      if (bytes.length > 8 * 1024 * 1024) throw new Error("File too large; upload it in the app instead");
      const mime = a.mime_type ?? (a.text_content !== undefined ? "text/plain" : "application/octet-stream");
      const id = await storeEvidence(ctx.db, {
        matterId: a.matter_id,
        filename: a.filename,
        mimeType: mime,
        bytes,
        kind: (a.kind as EvidenceKind) ?? guessKind(mime, a.filename),
        description: a.description ?? null,
        sourceDate: a.source_date ?? null,
        actor: { userId: ctx.userId, via: "ai" },
      });
      for (const eventId of a.link_to_event_ids ?? []) {
        await attachEvidence(ctx.db, a.matter_id, eventId, [{ evidence_id: id }]);
      }
      return ok({ evidence_id: id });
    })
  );

  // ── File handoff without base64 ──────────────────────────────────────────
  // ChatGPT passes files (uploads, generated PDFs) as { download_url, file_id, ... } when a tool
  // declares _meta["openai/fileParams"]. Other clients can pass any https URL in source_url.
  const fileUploadShape = {
    matter_id: z.string().uuid(),
    file: z
      .object({
        download_url: z.string().url(),
        file_id: z.string().optional(),
        file_name: z.string().optional(),
        mime_type: z.string().optional(),
      })
      .optional()
      .describe("A file from the conversation (ChatGPT fills this in automatically)"),
    source_url: z.string().url().optional().describe("Alternative: a direct https link to the file"),
    filename: z.string().optional().describe("Name to store it under; defaults to the file's own name"),
    kind: z.enum(EVIDENCE_KINDS).optional(),
    description: z.string().optional(),
    source_date: dateStr.optional(),
    link_to_events: z
      .array(
        z.object({
          event_id: z.string().uuid(),
          excerpt: z.string().optional().nullable(),
          page_ref: z.string().optional().nullable(),
        })
      )
      .max(100)
      .optional()
      .describe("Events this file supports, with exact quote and page/row for each"),
  };
  const fileUploadDescription =
    "Store an original evidence file (PDF, screenshot, photo, CSV — up to 45 MB) by reference instead of base64, " +
    "then optionally link it to events. Use this for files that exist in the conversation.";
  const fileUploadHandler = wrap(async (a: any) => {
    await requireWrite(ctx, a.matter_id);
    const url: string | undefined = a.file?.download_url ?? a.source_url;
    if (!url) throw new Error("Provide file (from the conversation) or source_url");
    const { bytes, contentType, nameFromUrl } = await fetchFile(url);
    const filename = a.filename || a.file?.file_name || nameFromUrl || "evidence-file";
    const mime = a.file?.mime_type || contentType || "application/octet-stream";
    const id = await storeEvidence(ctx.db, {
      matterId: a.matter_id,
      filename,
      mimeType: mime,
      bytes,
      kind: (a.kind as EvidenceKind) ?? guessKind(mime, filename),
      description: a.description ?? null,
      sourceDate: a.source_date ?? null,
      actor: { userId: ctx.userId, via: "ai" },
    });
    let linked = 0;
    for (const l of a.link_to_events ?? []) {
      await attachEvidence(ctx.db, a.matter_id, l.event_id, [
        { evidence_id: id, excerpt: l.excerpt ?? null, page_ref: l.page_ref ?? null },
      ]);
      linked++;
    }
    return ok({ evidence_id: id, filename, size_bytes: bytes.length, linked_events: linked });
  });

  const anyServer = server as any;
  if (typeof anyServer.registerTool === "function") {
    anyServer.registerTool(
      "upload_evidence_file",
      {
        description: fileUploadDescription,
        inputSchema: fileUploadShape,
        _meta: { "openai/fileParams": ["file"] },
      },
      fileUploadHandler
    );
  } else {
    server.tool("upload_evidence_file", fileUploadDescription, fileUploadShape, fileUploadHandler);
  }

  server.tool(
    "attach_evidence",
    "Link existing evidence to an event, with the exact supporting quote and where it appears.",
    {
      event_id: z.string().uuid(),
      items: z
        .array(
          z.object({
            evidence_id: z.string().uuid(),
            excerpt: z.string().optional().nullable(),
            page_ref: z.string().optional().nullable(),
          })
        )
        .min(1)
        .max(50),
    },
    wrap(async (a: any) => {
      const matterId = await eventMatter(ctx, a.event_id);
      await requireWrite(ctx, matterId);
      await attachEvidence(ctx.db, matterId, a.event_id, a.items);
      return ok({ attached: a.items.length });
    })
  );
}
