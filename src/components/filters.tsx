import { CONFIDENCE } from "@/lib/constants";
import type { EventFilters } from "@/lib/queries";

type Opts = {
  issues: { id: string; title: string }[];
  people: { id: string; name: string }[];
  tags: { tag: string; count: number }[];
};

/** Plain GET form so filters live in the URL (shareable, back-button friendly). */
export function Filters({ f, opts, action }: { f: EventFilters; opts: Opts; action: string }) {
  const active = Object.values(f).some(Boolean);
  return (
    <details className="card no-print" open={active}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>
        Search & filter{active ? " (on)" : ""}
      </summary>
      <form method="get" action={action} style={{ marginTop: 12 }}>
        <div className="filters">
          <input className="full" type="search" name="q" placeholder="Search words, e.g. late pickup" defaultValue={f.q ?? ""} />
          <select name="issue" defaultValue={f.issue ?? ""}>
            <option value="">All issues</option>
            {opts.issues.map((i) => (
              <option key={i.id} value={i.id}>{i.title}</option>
            ))}
          </select>
          <select name="tag" defaultValue={f.tag ?? ""}>
            <option value="">All tags</option>
            {opts.tags.map((t) => (
              <option key={t.tag} value={t.tag}>#{t.tag} ({t.count})</option>
            ))}
          </select>
          <select name="person" defaultValue={f.person ?? ""}>
            <option value="">Anyone</option>
            {opts.people.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select name="confidence" defaultValue={f.confidence ?? ""}>
            <option value="">Any confidence</option>
            {CONFIDENCE.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <label className="muted" style={{ fontSize: "0.85rem" }}>
            From
            <input type="date" name="from" defaultValue={f.from ?? ""} />
          </label>
          <label className="muted" style={{ fontSize: "0.85rem" }}>
            To
            <input type="date" name="to" defaultValue={f.to ?? ""} />
          </label>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn primary">Apply</button>
          {active && <a className="btn" href={action}>Clear</a>}
        </div>
      </form>
    </details>
  );
}

export function readFilters(sp: Record<string, string | string[] | undefined>): EventFilters {
  const g = (k: string) => {
    const v = sp[k];
    const s = Array.isArray(v) ? v[0] : v;
    return s && s.trim() ? s.trim() : undefined;
  };
  return {
    q: g("q"),
    tag: g("tag"),
    issue: g("issue"),
    person: g("person"),
    from: g("from"),
    to: g("to"),
    confidence: g("confidence"),
  };
}

export function filtersToQuery(f: EventFilters) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}
