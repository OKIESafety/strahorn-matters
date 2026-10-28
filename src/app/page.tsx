import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { ROLE_LABELS } from "@/lib/constants";
import { createMatter, signOut } from "./actions";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  const { all } = await searchParams;
  const { supabase, user } = await getUser();
  if (!user) redirect("/login");

  const { data: memberships } = await supabase
    .from("matter_members")
    .select("role, matters(id, title, description)")
    .eq("user_id", user.id);

  const matters = (memberships ?? [])
    .filter((m) => m.matters)
    .map((m) => ({ role: m.role as string, ...(m.matters as unknown as { id: string; title: string; description: string | null }) }));

  // Most people have one matter — go straight to it.
  if (matters.length === 1 && !all) redirect(`/m/${matters[0].id}`);

  return (
    <main className="container" style={{ paddingTop: 24 }}>
      <div className="row between" style={{ marginBottom: 16 }}>
        <h1>Matters</h1>
        <form action={signOut}>
          <button className="btn small">Sign out</button>
        </form>
      </div>

      {matters.map((m) => (
        <Link key={m.id} href={`/m/${m.id}`} className="card event-item">
          <div className="event-title">{m.title}</div>
          {m.description && <div className="event-summary">{m.description}</div>}
          <small>{ROLE_LABELS[m.role] ?? m.role}</small>
        </Link>
      ))}

      <form action={createMatter} className="card">
        <h2>New matter</h2>
        <div className="field">
          <label htmlFor="title">Name</label>
          <input id="title" name="title" type="text" required placeholder="Strahorn Custody" />
        </div>
        <div className="field">
          <label htmlFor="description">Description (optional)</label>
          <input id="description" name="description" type="text" />
        </div>
        <button className="btn primary">Create matter</button>
      </form>
    </main>
  );
}
