import Link from "next/link";
import { CONFIDENCE } from "@/lib/constants";
import { formatDate, formatTime } from "@/lib/format";
import type { EventRow } from "@/lib/queries";

export function ConfidenceChip({ value }: { value: string }) {
  const label = CONFIDENCE.find((c) => c.value === value)?.label ?? value;
  return <span className={`chip conf-${value}`}>{label}</span>;
}

export function EventCard({ e, href }: { e: EventRow; href: string }) {
  return (
    <Link href={href} className="card event-item">
      <div className="row between">
        <span className="event-date">
          {formatDate(e.event_date)}
          {e.event_time ? ` · ${formatTime(e.event_time)}` : ""}
        </span>
        <span className="row" style={{ gap: 6 }}>
          {e.evidence_count > 0 && <span className="chip">📎 {e.evidence_count}</span>}
          <ConfidenceChip value={e.confidence} />
        </span>
      </div>
      <div className="event-title">{e.title}</div>
      {e.summary && <div className="event-summary">{e.summary}</div>}
      {(e.issues.length > 0 || e.tags.length > 0 || e.exclude_from_reports) && (
        <div className="chips" style={{ marginTop: 8 }}>
          {e.issues.map((i) => (
            <span key={i.id} className="chip issue">{i.title}</span>
          ))}
          {e.tags.map((t) => (
            <span key={t} className="chip">#{t}</span>
          ))}
          {e.exclude_from_reports && <span className="chip ai">left out of reports</span>}
        </div>
      )}
    </Link>
  );
}
