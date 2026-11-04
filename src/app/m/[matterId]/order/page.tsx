import { requireMatter } from "@/lib/access";
import { groupByCategory, loadCase, loadOrders, ORDER_CATEGORIES, type Provision } from "@/lib/orders";
import { deleteProvisionAction, saveCaseAction, saveProvisionAction } from "./actions";
import { PrintButton } from "../report/print-button";

function ProvisionForm({ matterId, p }: { matterId: string; p?: Provision }) {
  return (
    <form action={saveProvisionAction.bind(null, matterId, p?.id ?? null)} style={{ marginTop: 10 }}>
      <div className="row">
        <select name="category" defaultValue={p?.category ?? "Disputes & going back to court"} style={{ flex: 1 }}>
          {ORDER_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <label className="chip" style={{ whiteSpace: "nowrap" }}>
          <input type="checkbox" name="key_fact" defaultChecked={p?.key_fact ?? false} />
          Key fact
        </label>
      </div>
      <input name="title" type="text" required placeholder="Title" defaultValue={p?.title} style={{ marginTop: 8 }} />
      <textarea name="summary" required placeholder="Plain-English summary" defaultValue={p?.summary} style={{ marginTop: 8, minHeight: 80 }} />
      <textarea name="quote" placeholder="Exact wording from the order (optional)" defaultValue={p?.quote ?? ""} style={{ marginTop: 8, minHeight: 60 }} />
      <input name="citation" type="text" placeholder="Where it is, e.g. Joint Custody Plan ¶16 (PDF p. 15)" defaultValue={p?.citation ?? ""} style={{ marginTop: 8 }} />
      <button className="btn small primary" style={{ marginTop: 8 }}>{p ? "Save" : "Add term"}</button>
    </form>
  );
}

export default async function OrderPage({ params }: { params: Promise<{ matterId: string }> }) {
  const { matterId } = await params;
  const { supabase, isOwner } = await requireMatter(matterId);
  const [c, list] = await Promise.all([loadCase(supabase, matterId), loadOrders(supabase, matterId)]);
  const keys = list.filter((p) => p.key_fact);

  return (
    <>
      <div className="row between">
        <h1>Court order</h1>
        <div className="no-print"><PrintButton /></div>
      </div>
      <p className="muted" style={{ fontSize: "0.9rem" }}>
        What the decree and custody plan say, with the paragraph and page for each. Key facts appear on every attorney report.
      </p>

      <div className="card case-card">
        {c.case_number && <div className="eyebrow">Case No. {c.case_number}</div>}
        <div className="case-caption">{c.caption ?? c.title}</div>
        {c.court && <div className="muted" style={{ fontSize: "0.9rem" }}>{c.court}</div>}
        {isOwner && (
          <details className="no-print" style={{ marginTop: 8 }}>
            <summary className="muted" style={{ cursor: "pointer", fontSize: "0.85rem" }}>Edit case details</summary>
            <form action={saveCaseAction.bind(null, matterId)} style={{ marginTop: 8 }}>
              <input name="case_number" type="text" defaultValue={c.case_number ?? ""} placeholder="Case number" />
              <input name="court" type="text" defaultValue={c.court ?? ""} placeholder="Court" style={{ marginTop: 8 }} />
              <textarea name="caption" defaultValue={c.caption ?? ""} placeholder="Caption" style={{ marginTop: 8, minHeight: 60 }} />
              <button className="btn small" style={{ marginTop: 8 }}>Save</button>
            </form>
          </details>
        )}
      </div>

      {keys.length > 0 && (
        <div className="card">
          <h2>At a glance</h2>
          <div className="glance">
            {keys.map((p) => (
              <div key={p.id} className="glance-item">
                <div className="glance-title">{p.title}</div>
                <div>{p.summary}</div>
                {p.citation && <div className="cite">{p.citation}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {groupByCategory(list).map(([cat, items]) => (
        <section key={cat} className="card">
          <h2>{cat}</h2>
          {items.map((p) => (
            <div key={p.id} className="provision">
              <div className="row between">
                <strong>{p.title}</strong>
                {p.key_fact && <span className="chip issue">Key fact</span>}
              </div>
              <div>{p.summary}</div>
              {p.quote && <div className="quote">“{p.quote}”</div>}
              {p.citation && <div className="cite">{p.citation}</div>}
              {isOwner && (
                <details className="no-print">
                  <summary className="muted" style={{ cursor: "pointer", fontSize: "0.8rem" }}>Edit</summary>
                  <ProvisionForm matterId={matterId} p={p} />
                  <form action={deleteProvisionAction.bind(null, matterId, p.id)} style={{ marginTop: 6 }}>
                    <button className="btn small danger">Remove</button>
                  </form>
                </details>
              )}
            </div>
          ))}
        </section>
      ))}

      {isOwner && (
        <div className="card no-print">
          <h2>Add a term</h2>
          <p className="muted" style={{ fontSize: "0.88rem" }}>For later orders, agreed changes, or anything your attorney flags.</p>
          <ProvisionForm matterId={matterId} />
        </div>
      )}
    </>
  );
}
