import "server-only";
import { notFound, redirect } from "next/navigation";
import { getUser } from "./supabase/server";

export type Role = "owner" | "contributor" | "reviewer";

/** Loads the matter for the signed-in user; 404s if they aren't a member. */
export async function requireMatter(matterId: string) {
  const { supabase, user } = await getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("matter_members")
    .select("role, matters(id, title, description)")
    .eq("matter_id", matterId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership || !membership.matters) notFound();
  const matter = membership.matters as unknown as { id: string; title: string; description: string | null };
  const role = membership.role as Role;
  return {
    supabase,
    user,
    matter,
    role,
    canWrite: role === "owner" || role === "contributor",
    isOwner: role === "owner",
  };
}
