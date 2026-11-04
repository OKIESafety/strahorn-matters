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
