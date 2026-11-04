import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export const ORDER_CATEGORIES = [
  "Case",
  "Custody & primary residence",
  "Decision-making",
  "Parenting time",
  "Disputes & going back to court",
  "Support & expenses",
  "Conduct & communication",
  "Other",
];

export type Provision = {
  id: string;
  category: string;
  title: string;
  summary: string;
  quote: string | null;
  citation: string | null;
  key_fact: boolean;
  sort: number;
};

export type MatterCase = {
  title: string;
  case_number: string | null;
  court: string | null;
  caption: string | null;
  report_summary: string | null;
};

export async function loadOrders(db: SupabaseClient, matterId: string): Promise<Provision[]> {
  const { data } = await db
    .from("order_provisions")
    .select("id, category, title, summary, quote, citation, key_fact, sort")
    .eq("matter_id", matterId)
    .order("sort")
    .order("created_at");
  return (data ?? []) as Provision[];
}

export async function loadCase(db: SupabaseClient, matterId: string): Promise<MatterCase> {
  const { data } = await db
    .from("matters")
    .select("title, case_number, court, caption, report_summary")
    .eq("id", matterId)
    .single();
  return data as MatterCase;
}

export function groupByCategory(list: Provision[]) {
  const order = new Map(ORDER_CATEGORIES.map((c, i) => [c, i]));
  const groups = new Map<string, Provision[]>();
  for (const p of list) {
    const g = groups.get(p.category) ?? [];
    g.push(p);
    groups.set(p.category, g);
  }
  return Array.from(groups.entries()).sort((a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99));
}
