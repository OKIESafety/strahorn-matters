/** Minimal server-rendered bar chart (SVG), readable on phones and in print. */
export function BarChart({
  data,
  height = 160,
  unit = "",
  title,
}: {
  data: { label: string; value: number }[];
  height?: number;
  unit?: string;
  title: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const w = Math.max(320, data.length * 28);
  const barW = (w - 20) / Math.max(1, data.length);
  const chartH = height - 34;
  return (
    <figure style={{ margin: 0 }}>
      <figcaption className="muted" style={{ fontSize: "0.85rem", marginBottom: 6 }}>{title}</figcaption>
      <div style={{ overflowX: "auto" }}>
        <svg viewBox={`0 0 ${w} ${height}`} width="100%" style={{ minWidth: Math.min(w, 640) }} role="img" aria-label={title}>
          <line x1="10" x2={w - 10} y1={chartH + 4} y2={chartH + 4} stroke="var(--border)" />
          {data.map((d, i) => {
            const h = (d.value / max) * (chartH - 14);
            const x = 10 + i * barW + barW * 0.15;
            const bw = barW * 0.7;
            return (
              <g key={d.label}>
                <rect x={x} y={chartH + 4 - h} width={bw} height={h} rx="2" fill="var(--accent)">
                  <title>{`${d.label}: ${d.value}${unit}`}</title>
                </rect>
                {d.value > 0 && (
                  <text x={x + bw / 2} y={chartH - h} fontSize="9" textAnchor="middle" fill="var(--text)">
                    {d.value}
                  </text>
                )}
                <text x={x + bw / 2} y={height - 14} fontSize="8.5" textAnchor="middle" fill="var(--muted)">
                  {d.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}

export function HBarList({ data, title }: { data: { label: string; value: number }[]; title: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div>
      <div className="muted" style={{ fontSize: "0.85rem", marginBottom: 6 }}>{title}</div>
      {data.map((d) => (
        <div key={d.label} style={{ marginBottom: 6 }}>
          <div className="row between" style={{ fontSize: "0.88rem" }}>
            <span>{d.label}</span>
            <b>{d.value}</b>
          </div>
          <div className="bar">
            <span className="bar-fill" style={{ width: `${(d.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
