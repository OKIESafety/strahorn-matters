import { redirect } from "next/navigation";
import { requireMatter } from "@/lib/access";
import { loadFilterOptions } from "@/lib/queries";
import { SUGGESTED_TAGS } from "@/lib/constants";
import { todayLocal } from "@/lib/format";
import { NewEventForm } from "./form";

export default async function NewEventPage({ params }: { params: Promise<{ matterId: string }> }) {
  const { matterId } = await params;
  const { supabase, canWrite } = await requireMatter(matterId);
  if (!canWrite) redirect(`/m/${matterId}`);
  const opts = await loadFilterOptions(supabase, matterId);
  const tags = Array.from(new Set([...opts.tags.map((t) => t.tag), ...SUGGESTED_TAGS])).slice(0, 24);

  return (
    <>
      <h1>New event</h1>
      <NewEventForm
        matterId={matterId}
        today={todayLocal()}
        issues={opts.issues.map((i) => i.title)}
        people={opts.people.map((p) => p.name)}
        tags={tags}
      />
    </>
  );
}
