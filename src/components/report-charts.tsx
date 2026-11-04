/** Print-friendly SVG charts for the attorney report. Pure server components. */

const INK = "#1d2b36";
const MUTED = "#6b7280";
const A_COLOR = "#2f5d50"; // Jonathan
const B_COLOR = "#b08d57"; // Brandy
const GRID = "#e5e7eb";

export function ShareCompare({
  parents,
  ordered,
  actual,
}: {
  parents: { a: string; b: string };
  ordered: { a: number; b: number };
  actual: { a: number; b: number };
}) {
  const rows = [
    { label: "Court-ordered", v: ordered },
    { label: "Actual", v: actual },
  ];
  const W = 640;
  const barH = 34;
  const left = 130;
  const w = W - left - 20;
  return (
    <svg viewBox={`0 0 ${W} ${rows.length * 56 + 40}`} width="100%" role="img" aria-label="Share of parenting time, ordered vs actual">
      {rows.map((r, i) => {
        const y = 10 + i * 56;
        const aw = (r.v.a / 100) * w;
        return (
          <g key={r.label}>
            <text x={0} y={y + barH / 2 + 5} fontSize="14" fill={INK} fontWeight="600">{r.label}</text>
            <rect x={left} y={y} width={aw} height={barH} fill={A_COLOR} rx="3" />
            <rect x={left + aw} y={y} width={w - aw} height={barH} fill={B_COLOR} rx="3" />
            {r.v.a >= 8 && (
              <text x={left + 8} y={y + barH / 2 + 5} fontSize="13" fill="#fff" fontWeight="700">{r.v.a}%</text>
            )}
            {r.v.b >= 8 && (
              <text x={left + w - 8} y={y + barH / 2 + 5} fontSize="13" fill="#fff" fontWeight="700" textAnchor="end">{r.v.b}%</text>
            )}
          </g>
        );
      })}
      <g transform={`translate(${left}, ${rows.length * 56 + 18})`}>
        <rect width="12" height="12" fill={A_COLOR} rx="2" />
        <text x="18" y="11" fontSize="13" fill={INK}>{parents.a}</text>
        <rect x="140" width="12" height="12" fill={B_COLOR} rx="2" />
        <text x="158" y="11" fontSize="13" fill={INK}>{parents.b}</text>
      </g>
    </svg>
  );
}

export function ColumnChart({ data, color = A_COLOR, label }: { data: { label: string; value: number }[]; color?: string; label: string }) {
  const n = Math.max(1, data.length);
  const W = Math.max(560, n * 34);
  const H = 220;
  const top = 18;
  const bottom = 34;
  const left = 30;
  const max = Math.max(1, ...data.map((d) => d.value));
  const step = max <= 5 ? 1 : Math.ceil(max / 5);
  const ticks: number[] = [];
  for (let t = 0; t <= max; t += step) ticks.push(t);
  const ch = H - top - bottom;
  const bw = (W - left - 10) / n;
  const every = n > 18 ? Math.ceil(n / 12) : 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label}>
      {ticks.map((t) => {
        const y = top + ch - (t / max) * ch;
        return (
          <g key={t}>
            <line x1={left} x2={W - 10} y1={y} y2={y} stroke={GRID} />
            <text x={left - 6} y={y + 4} fontSize="10" fill={MUTED} textAnchor="end">{t}</text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const h = (d.value / max) * ch;
        const x = left + i * bw + bw * 0.18;
        const w = bw * 0.64;
        return (
          <g key={`${d.label}-${i}`}>
            <rect x={x} y={top + ch - h} width={w} height={h} fill={color} rx="2" />
            {d.value > 0 && (
              <text x={x + w / 2} y={top + ch - h - 4} fontSize="10" fill={INK} textAnchor="middle" fontWeight="600">{d.value}</text>
            )}
            {i % every === 0 && (
              <text x={x + w / 2} y={H - 14} fontSize="10" fill={MUTED} textAnchor="middle">{d.label}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function BarList({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const rows = data.slice(0, 12);
  const W = 640;
  const left = 230;
  const rowH = 28;
  return (
    <svg viewBox={`0 0 ${W} ${rows.length * rowH + 6}`} width="100%" role="img" aria-label="Events by issue">
      {rows.map((d, i) => {
        const y = i * rowH + 4;
        const w = ((W - left - 50) * d.value) / max;
        return (
          <g key={d.label}>
            <text x={0} y={y + 15} fontSize="12" fill={INK}>{d.label.length > 34 ? d.label.slice(0, 33) + "…" : d.label}</text>
            <rect x={left} y={y + 3} width={Math.max(2, w)} height={16} fill={A_COLOR} rx="2" />
            <text x={left + w + 6} y={y + 15} fontSize="12" fill={INK} fontWeight="600">{d.value}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Consistent issue colors across the whole report (colorblind-friendly order). */
export const ISSUE_COLORS = ["#2f6f8f", "#c0583b", "#5b8c3a", "#8a5ba8", "#c9a227", "#3a9a92", "#b84a7a", "#6d7280", "#8c6d3f", "#4a6fd1"];
export function issueColor(index: number) {
  return ISSUE_COLORS[index % ISSUE_COLORS.length];
}

function dayNum(d: string) {
  const [y, m, dd] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, dd) / 86_400_000;
}

/** One row per issue, one dot per event on its date. Shows when things cluster. */
export function IssueTimeline({
  groups,
}: {
  groups: { label: string; color: string; dates: string[] }[];
}) {
  const all = groups.flatMap((g) => g.dates).sort();
  if (!all.length) return null;
  const min = dayNum(all[0]);
  const max = Math.max(min + 30, dayNum(all[all.length - 1]));
  const W = 700;
  const left = 190;
  const right = 16;
  const rowH = 30;
  const top = 8;
  const H = top + groups.length * rowH + 30;
  const x = (d: string) => left + ((dayNum(d) - min) / (max - min)) * (W - left - right);
  // month / year ticks
  const ticks: { x: number; label: string }[] = [];
  const start = new Date(min * 86_400_000);
  const spanDays = max - min;
  const stepMonths = spanDays > 900 ? 6 : spanDays > 400 ? 3 : spanDays > 120 ? 1 : 1;
  const t = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  while (t.getTime() / 86_400_000 <= max) {
    const iso = t.toISOString().slice(0, 10);
    ticks.push({
      x: x(iso),
      label: t.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }),
    });
    t.setUTCMonth(t.getUTCMonth() + stepMonths);
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Timeline of events by issue">
      {ticks.map((tk) => (
        <g key={tk.label + tk.x}>
          <line x1={tk.x} x2={tk.x} y1={top} y2={H - 26} stroke={GRID} />
          <text x={tk.x} y={H - 10} fontSize="10" fill={MUTED} textAnchor="middle">{tk.label}</text>
        </g>
      ))}
      {groups.map((g, i) => {
        const y = top + i * rowH + rowH / 2;
        return (
          <g key={g.label}>
            <text x={0} y={y + 4} fontSize="12" fill={INK}>
              {g.label.length > 26 ? g.label.slice(0, 25) + "…" : g.label}
            </text>
            <text x={left - 8} y={y + 4} fontSize="11" fill={MUTED} textAnchor="end">{g.dates.length}</text>
            <line x1={left} x2={W - right} y1={y} y2={y} stroke={GRID} strokeDasharray="2 3" />
            {g.dates.map((d, j) => (
              <circle key={j} cx={x(d)} cy={y} r={5.5} fill={g.color} fillOpacity={0.8} stroke="#fff" strokeWidth={1} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

/** Events per month, stacked by issue color. */
export function StackedMonths({
  months,
  series,
}: {
  months: string[]; // labels
  series: { label: string; color: string; values: number[] }[];
}) {
  const n = Math.max(1, months.length);
  const W = Math.max(600, n * 30);
  const H = 230;
  const top = 16;
  const bottom = 30;
  const left = 30;
  const totals = months.map((_, i) => series.reduce((s, x) => s + (x.values[i] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const ch = H - top - bottom;
  const bw = (W - left - 10) / n;
  const step = max <= 5 ? 1 : Math.ceil(max / 5);
  const ticks: number[] = [];
  for (let t = 0; t <= max; t += step) ticks.push(t);
  const every = n > 18 ? Math.ceil(n / 12) : 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Events per month by issue">
      {ticks.map((t) => {
        const y = top + ch - (t / max) * ch;
        return (
          <g key={t}>
            <line x1={left} x2={W - 10} y1={y} y2={y} stroke={GRID} />
            <text x={left - 6} y={y + 4} fontSize="10" fill={MUTED} textAnchor="end">{t}</text>
          </g>
        );
      })}
      {months.map((m, i) => {
        let acc = 0;
        const x = left + i * bw + bw * 0.18;
        const w = bw * 0.64;
        return (
          <g key={m + i}>
            {series.map((s) => {
              const v = s.values[i] ?? 0;
              if (!v) return null;
              const h = (v / max) * ch;
              const y = top + ch - ((acc + v) / max) * ch;
              acc += v;
              return <rect key={s.label} x={x} y={y} width={w} height={h} fill={s.color} />;
            })}
            {totals[i] > 0 && (
              <text x={x + w / 2} y={top + ch - (totals[i] / max) * ch - 4} fontSize="10" fill={INK} textAnchor="middle" fontWeight="600">
                {totals[i]}
              </text>
            )}
            {i % every === 0 && (
              <text x={x + w / 2} y={H - 10} fontSize="10" fill={MUTED} textAnchor="middle">{m}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
