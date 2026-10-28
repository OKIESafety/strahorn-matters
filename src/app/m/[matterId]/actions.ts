"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireMatter } from "@/lib/access";
import {
  attachEvidence,
  createEvents,
  ensureIssues,
  ensurePeople,
  guessKind,
  isValidDate,
  normalizeTags,
  normalizeTime,
  recordEvidence,
  sha256Hex,
} from "@/lib/core";
import { CONFIDENCE_VALUES, EVIDENCE_KINDS, type Confidence, type EvidenceKind } from "@/lib/constants";
import type { UploadedFile } from "@/lib/upload-client";

type Result = { ok: true; id?: string } | { ok: false; error: string };

/** Re-downloads each uploaded original, re-hashes it on the server, and records it. */
async function verifyAndRecord(
  supabase: SupabaseClient,
  matterId: string,
  userId: string,
  files: UploadedFile[],
  description: string | null,
  kind?: EvidenceKind
) {
  const ids: string[] = [];
  for (const f of files) {
    if (!f.storagePath.startsWith(`${matterId}/`)) throw new Error("Invalid upload path");
    const { data, error } = await supabase.storage.from("evidence").download(f.storagePath);
    if (error || !data) throw new Error(`Could not verify ${f.filename}`);
    const bytes = Buffer.from(await data.arrayBuffer());
    const hash = sha256Hex(bytes);
    if (hash !== f.sha256) throw new Error(`Integrity check failed for ${f.filename}`);
    const id = await recordEvidence(supabase, {
      matterId,
      storagePath: f.storagePath,
      filename: f.filename,
      mimeType: f.mimeType,
      size: bytes.length,
      sha256: hash,
      kind: kind ?? guessKind(f.mimeType, f.filename),
      description,
      sourceDate: null,
      actor: { userId, via: "app" },
    });
    ids.push(id);
  }
  return ids;
}

export type NewEventInput = {
  title: string;
  summary: string;
  details: string;
  date: string;
  time: string;
  issues: string[];
  people: string[];
  tags: string[];
  confidence: string;
  files: UploadedFile[];
};

export async function createEventAction(matterId: string, input: NewEventInput): Promise<Result> {
  try {
    const { supabase, user, canWrite } = await requireMatter(matterId);
    if (!canWrite) return { ok: false, error: "You have read-only access." };
    const summary = input.summary.trim();
    if (!summary) return { ok: false, error: "Describe what happened." };
    if (!isValidDate(input.date)) return { ok: false, error: "Pick a date." };

    const title =
      input.title.trim() ||
      (summary.split(/\n|(?<=[.!?])\s/)[0] ?? summary).slice(0, 90);

    const evidenceIds = await verifyAndRecord(supabase, matterId, user.id, input.files, null);

    const [res] = await createEvents(
      supabase,
      matterId,
      [
        {
          date: input.date,
          time: input.time || null,
          title,
          summary,
          details: input.details || null,
          tags: input.tags,
          issues: input.issues,
          people: input.people,
          confidence: (CONFIDENCE_VALUES as string[]).includes(input.confidence)
            ? (input.confidence as Confidence)
            : "reported",
          evidence: evidenceIds.map((id) => ({ evidence_id: id })),
        },
      ],
      { userId: user.id, via: "app" },
      "create"
    );
    if (res.status === "error") return { ok: false, error: res.error };
    if (res.status !== "created") return { ok: false, error: "Not saved." };
    revalidatePath(`/m/${matterId}`);
    return { ok: true, id: res.event_id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function addEvidenceAction(
  matterId: string,
  eventId: string | null,
  files: UploadedFile[],
  description: string,
  kind: string
): Promise<Result> {
  try {
    const { supabase, user, canWrite } = await requireMatter(matterId);
    if (!canWrite) return { ok: false, error: "You have read-only access." };
    const k = (EVIDENCE_KINDS as readonly string[]).includes(kind) ? (kind as EvidenceKind) : undefined;
    const ids = await verifyAndRecord(supabase, matterId, user.id, files, description.trim() || null, k);
    if (eventId) await attachEvidence(supabase, matterId, eventId, ids.map((id) => ({ evidence_id: id })));
    revalidatePath(`/m/${matterId}`, "layout");
    return { ok: true, id: ids[0] };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function updateEventAction(matterId: string, eventId: string, formData: FormData) {
  const { supabase, user, canWrite } = await requireMatter(matterId);
  if (!canWrite) throw new Error("Read-only access");

  const date = String(formData.get("date") ?? "");
  if (!isValidDate(date)) throw new Error("Invalid date");
  const confidence = String(formData.get("confidence") ?? "reported");

  const { error } = await supabase
    .from("events")
    .update({
      title: String(formData.get("title") ?? "").trim() || "Untitled",
      summary: String(formData.get("summary") ?? "").trim(),
      details: String(formData.get("details") ?? "").trim() || null,
      event_date: date,
      event_time: normalizeTime(String(formData.get("time") ?? "")),
      confidence: (CONFIDENCE_VALUES as string[]).includes(confidence) ? confidence : "reported",
      tags: normalizeTags(String(formData.get("tags") ?? "").split(",")),
      source_ref: String(formData.get("source_ref") ?? "").trim() || null,
    })
    .eq("id", eventId)
    .eq("matter_id", matterId);
  if (error) throw new Error(error.message);

  // Issues: replace links with the selected set (+ any newly typed issue)
  const selected = formData.getAll("issue").map(String);
  const newIssue = String(formData.get("new_issue") ?? "").trim();
  const issueMap = await ensureIssues(supabase, matterId, [...selected, newIssue].filter(Boolean), {
    userId: user.id,
    via: "app",
  });
  const wantIds = new Set([...selected, newIssue].filter(Boolean).map((t) => issueMap.get(t.toLowerCase())!));
  const { data: current } = await supabase.from("event_issues").select("issue_id").eq("event_id", eventId);
  const have = new Set((current ?? []).map((r) => r.issue_id));
  const toAdd = [...wantIds].filter((id) => !have.has(id));
  const toRemove = [...have].filter((id) => !wantIds.has(id));
  if (toAdd.length) await supabase.from("event_issues").insert(toAdd.map((issue_id) => ({ event_id: eventId, issue_id })));
  if (toRemove.length) await supabase.from("event_issues").delete().eq("event_id", eventId).in("issue_id", toRemove);

  // People
  const peopleSel = formData.getAll("person").map(String);
  const newPerson = String(formData.get("new_person") ?? "").trim();
  const pMap = await ensurePeople(supabase, matterId, [...peopleSel, newPerson].filter(Boolean));
  const wantP = new Set([...peopleSel, newPerson].filter(Boolean).map((n) => pMap.get(n.toLowerCase())!));
  const { data: curP } = await supabase.from("event_people").select("person_id").eq("event_id", eventId);
  const haveP = new Set((curP ?? []).map((r) => r.person_id));
  const addP = [...wantP].filter((id) => !haveP.has(id));
  const remP = [...haveP].filter((id) => !wantP.has(id));
  if (addP.length) await supabase.from("event_people").insert(addP.map((person_id) => ({ event_id: eventId, person_id })));
  if (remP.length) await supabase.from("event_people").delete().eq("event_id", eventId).in("person_id", remP);

  revalidatePath(`/m/${matterId}`, "layout");
  redirect(`/m/${matterId}/e/${eventId}`);
}

export async function markReviewedAction(matterId: string, eventId: string, formData: FormData) {
  const { supabase, canWrite } = await requireMatter(matterId);
  if (!canWrite) throw new Error("Read-only access");
  const confidence = String(formData.get("confidence") ?? "");
  if (!(CONFIDENCE_VALUES as string[]).includes(confidence)) throw new Error("Invalid value");
  await supabase.from("events").update({ confidence }).eq("id", eventId).eq("matter_id", matterId);
  revalidatePath(`/m/${matterId}`, "layout");
}

export async function deleteEventAction(matterId: string, eventId: string) {
  const { supabase, isOwner } = await requireMatter(matterId);
  if (!isOwner) throw new Error("Only the owner can delete events");
  // Evidence files are kept; only the event and its links are removed (audit-logged).
  const { error } = await supabase.from("events").delete().eq("id", eventId).eq("matter_id", matterId);
  if (error) throw new Error(error.message);
  revalidatePath(`/m/${matterId}`, "layout");
  redirect(`/m/${matterId}`);
}

export async function addNoteAction(
  matterId: string,
  target: { eventId?: string; issueId?: string },
  formData: FormData
) {
  const { supabase, user } = await requireMatter(matterId);
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return;
  const { error } = await supabase.from("notes").insert({
    matter_id: matterId,
    event_id: target.eventId ?? null,
    issue_id: target.issueId ?? null,
    body,
    author: user.id,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/m/${matterId}`, "layout");
}

export async function createIssueAction(matterId: string, formData: FormData) {
  const { supabase, user, canWrite } = await requireMatter(matterId);
  if (!canWrite) throw new Error("Read-only access");
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const map = await ensureIssues(supabase, matterId, [title], { userId: user.id, via: "app" });
  const description = String(formData.get("description") ?? "").trim();
  if (description) {
    await supabase.from("issues").update({ description }).eq("id", map.get(title.toLowerCase())!);
  }
  revalidatePath(`/m/${matterId}/issues`);
}

export async function addPersonAction(matterId: string, formData: FormData) {
  const { supabase, canWrite } = await requireMatter(matterId);
  if (!canWrite) throw new Error("Read-only access");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const map = await ensurePeople(supabase, matterId, [name]);
  const relationship = String(formData.get("relationship") ?? "").trim();
  if (relationship) await supabase.from("people").update({ relationship }).eq("id", map.get(name.toLowerCase())!);
  revalidatePath(`/m/${matterId}/settings`);
}
