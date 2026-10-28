"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireMatter } from "@/lib/access";
import { isValidDate, normalizeTime } from "@/lib/core";
import { validateTransitions, zonedToUtc } from "@/lib/parenting-time";
import { TIME_ZONE } from "@/lib/constants";

export async function saveParentsAction(matterId: string, formData: FormData) {
  const { supabase, isOwner } = await requireMatter(matterId);
  if (!isOwner) throw new Error("Only the owner can change this");
  const a = String(formData.get("parent_a") ?? "").trim();
  const b = String(formData.get("parent_b") ?? "").trim();
  if (!a || !b) throw new Error("Enter both names");
  const { error } = await supabase.from("matters").update({ parent_a: a, parent_b: b }).eq("id", matterId);
  if (error) throw new Error(error.message);
  revalidatePath(`/m/${matterId}`, "layout");
}

export type ScheduleInput = {
  id?: string;
  name: string;
  cycle_start: string;
  cycle_days: number;
  effective_from: string;
  effective_to: string;
  notes: string;
  transitions: { day: number; time: string; to: "a" | "b" }[];
};

export async function saveScheduleAction(matterId: string, input: ScheduleInput): Promise<{ ok: boolean; error?: string }> {
  try {
    const { supabase, user, canWrite } = await requireMatter(matterId);
    if (!canWrite) return { ok: false, error: "Read-only access" };
    const cycle = Number(input.cycle_days);
    if (!Number.isInteger(cycle) || cycle < 1 || cycle > 56) return { ok: false, error: "Cycle length must be 1–56 days" };
    if (!isValidDate(input.cycle_start)) return { ok: false, error: "Pick the first day of the cycle" };
    if (!isValidDate(input.effective_from)) return { ok: false, error: "Pick the date the schedule starts" };
    if (input.effective_to && !isValidDate(input.effective_to)) return { ok: false, error: "Invalid end date" };
    const transitions = validateTransitions(cycle, input.transitions);
    const row = {
      matter_id: matterId,
      name: input.name.trim() || "Court-ordered schedule",
      cycle_start: input.cycle_start,
      cycle_days: cycle,
      transitions,
      effective_from: input.effective_from,
      effective_to: input.effective_to || null,
      notes: input.notes.trim() || null,
    };
    const q = input.id
      ? supabase.from("schedules").update(row).eq("id", input.id).eq("matter_id", matterId)
      : supabase.from("schedules").insert({ ...row, created_by: user.id });
    const { error } = await q;
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/m/${matterId}/time`, "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function deleteScheduleAction(matterId: string, scheduleId: string) {
  const { supabase, isOwner } = await requireMatter(matterId);
  if (!isOwner) throw new Error("Only the owner can delete a schedule");
  await supabase.from("schedules").delete().eq("id", scheduleId).eq("matter_id", matterId);
  revalidatePath(`/m/${matterId}/time`, "layout");
}

export async function addOverrideAction(matterId: string, formData: FormData) {
  const { supabase, user, canWrite } = await requireMatter(matterId);
  if (!canWrite) throw new Error("Read-only access");
  const sd = String(formData.get("start_date") ?? "");
  const st = normalizeTime(String(formData.get("start_time") ?? "")) ?? "00:00";
  const ed = String(formData.get("end_date") ?? "");
  const et = normalizeTime(String(formData.get("end_time") ?? "")) ?? "00:00";
  const parent = String(formData.get("parent") ?? "");
  if (!isValidDate(sd) || !isValidDate(ed)) throw new Error("Pick start and end dates");
  if (parent !== "a" && parent !== "b") throw new Error("Pick who has the children");
  const starts = new Date(zonedToUtc(sd, st, TIME_ZONE)).toISOString();
  const ends = new Date(zonedToUtc(ed, et, TIME_ZONE)).toISOString();
  const { error } = await supabase.from("schedule_overrides").insert({
    matter_id: matterId,
    starts_at: starts,
    ends_at: ends,
    parent,
    reason: String(formData.get("reason") ?? "").trim() || null,
    created_by: user.id,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/m/${matterId}/time`, "layout");
}

export async function deleteOverrideAction(matterId: string, id: string) {
  const { supabase, canWrite } = await requireMatter(matterId);
  if (!canWrite) throw new Error("Read-only access");
  await supabase.from("schedule_overrides").delete().eq("id", id).eq("matter_id", matterId);
  revalidatePath(`/m/${matterId}/time`, "layout");
}

export type CheckinInput = {
  kind: "handoff" | "arrived" | "no_show" | "late_notice";
  to_parent: "a" | "b" | null;
  note: string;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  // past entry (not live)
  date?: string;
  time?: string;
};

export async function recordExchangeAction(matterId: string, input: CheckinInput): Promise<{ ok: boolean; error?: string; at?: string }> {
  try {
    const { supabase, user, canWrite } = await requireMatter(matterId);
    if (!canWrite) return { ok: false, error: "Read-only access" };
    if (!["handoff", "arrived", "no_show", "late_notice"].includes(input.kind)) return { ok: false, error: "Invalid type" };
    if (input.kind === "handoff" && input.to_parent !== "a" && input.to_parent !== "b")
      return { ok: false, error: "Who has the children now?" };
    const live = !input.date;
    let occurred = new Date();
    if (!live) {
      const t = normalizeTime(input.time ?? "");
      if (!isValidDate(input.date!) || !t) return { ok: false, error: "Enter the date and time it happened" };
      occurred = new Date(zonedToUtc(input.date!, t, TIME_ZONE));
      if (occurred.getTime() > Date.now() + 5 * 60_000) return { ok: false, error: "That time is in the future" };
    }
    const { error } = await supabase.from("exchanges").insert({
      matter_id: matterId,
      occurred_at: occurred.toISOString(),
      kind: input.kind,
      to_parent: input.to_parent,
      recorded_live: live,
      lat: live ? input.lat : null,
      lng: live ? input.lng : null,
      accuracy_m: live ? input.accuracy_m : null,
      note: input.note.trim() || null,
      recorded_by: user.id,
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/m/${matterId}/time`, "layout");
    return { ok: true, at: occurred.toISOString() };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function voidExchangeAction(matterId: string, id: string, formData: FormData) {
  const { supabase, canWrite } = await requireMatter(matterId);
  if (!canWrite) throw new Error("Read-only access");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) throw new Error("Say why this entry is being voided");
  const { error } = await supabase
    .from("exchanges")
    .update({ voided_at: new Date().toISOString(), void_reason: reason })
    .eq("id", id)
    .eq("matter_id", matterId);
  if (error) throw new Error(error.message);
  revalidatePath(`/m/${matterId}/time`, "layout");
  redirect(`/m/${matterId}/time/checkin`);
}
