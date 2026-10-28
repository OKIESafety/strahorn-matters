"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";

export async function createMatter(formData: FormData) {
  const { supabase, user } = await getUser();
  if (!user) redirect("/login");
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  // Generate the id here: the owner membership is added by a trigger, so the
  // new row isn't readable (RLS) until the insert statement finishes.
  const id = randomUUID();
  const { error } = await supabase.from("matters").insert({
    id,
    title,
    description: String(formData.get("description") ?? "").trim() || null,
    created_by: user.id,
  });
  if (error) throw new Error(error.message);
  redirect(`/m/${id}`);
}

export async function signOut() {
  const { supabase } = await getUser();
  await supabase.auth.signOut();
  redirect("/login");
}
