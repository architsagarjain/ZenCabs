/**
 * Small single-series charts for the dashboard trends row.
 * Specs (dataviz skill): one accent hue, 2px lines, 10% area wash, bars ≤24px with
 * 4px rounded data-ends, hairline solid gridlines, crosshair / per-bar tooltips,
 * a selective end label, and a table view for every chart.
 */
import { useMemo, useRef, useState, type ReactNode } from 'react';

const ACCENT = '#1E63C4';
const GRID = '#EEF1F5';
const AXIS = '#94A3B8';

export interface Point {
  x: number; // epoch ms or index
  y: number;
  label: string; // x label for tooltip/table
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(320);
  const ro = useMemo(
    () =>
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver((entries) => {
            for (const e of entries) setW(Math.max(200, Math.floor(e.contentRect.width)));
          })
        : null,
    [],
  );
  const setRef = (el: HTMLDivElement | null) => {
    if (ref.current && ro) ro.unobserve(ref.current);
    ref.current = el;
    if (el && ro) ro.observe(el);
  };
  return [setRef, w] as const;
}

interface ChartProps {
  points: Point[];
  format: (n: number) => string;
  height?: number;
  kind: 'bar' | 'area' | 'line';
  ariaLabel: string;
  /** Fixed y maximum (e.g. 100 for percentages). */
  yMax?: number;
}

export function MiniChart({ points, format, height = 150, kind, ariaLabel, yMax }: ChartProps) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 36, r: 12, t: 12, b: 22 };
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const max = yMax ?? niceMax(Math.max(0, ...points.map((p) => p.y)) * 1.1);
  const n = points.length;
  const xAt = (i: number) => pad.l + (kind === 'bar' ? ((i + 0.5) / Math.max(1, n)) * iw : n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const yAt = (v: number) => pad.t + ih - (v / max) * ih;
  const ticks = [0, max / 2, max];
  const barW = Math.min(24, (iw / Math.max(1, n)) * 0.62);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!n) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(xAt(i) - x);
      if (d < bd) (bd = d), (best = i);
    }
    setHover(best);
  };

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(p.y).toFixed(1)}`).join('');
  const area = n > 1 ? `${line}L${xAt(n - 1).toFixed(1)},${yAt(0)}L${xAt(0).toFixed(1)},${yAt(0)}Z` : '';
  const last = points[n - 1];
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 56))));

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label={ariaLabel} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={yAt(t)} y2={yAt(t)} stroke={GRID} strokeWidth={1} />
            <text x={pad.l - 8} y={yAt(t) + 4} textAnchor="end" fontSize={11} fill={AXIS} className="num">
              {format(t)}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          (i % labelEvery === 0 && n - 1 - i >= labelEvery * 0.6) || i === n - 1 ? (
            <text key={i} x={xAt(i)} y={height - 6} textAnchor="middle" fontSize={11} fill={AXIS}>
              {p.label}
            </text>
          ) : null,
        )}
        {kind === 'bar' &&
          points.map((p, i) => {
            const h = Math.max(0, yAt(0) - yAt(p.y));
            const x = xAt(i) - barW / 2;
            const y = yAt(p.y);
            const r = Math.min(4, h);
            return (
              <path
                key={i}
                d={`M${x},${yAt(0)}V${y + r}Q${x},${y} ${x + r},${y}H${x + barW - r}Q${x + barW},${y} ${x + barW},${y + r}V${yAt(0)}Z`}
                fill={ACCENT}
                opacity={hover == null || hover === i ? 1 : 0.55}
              />
            );
          })}
        {kind !== 'bar' && n > 1 && (
          <>
            {kind === 'area' && <path d={area} fill={ACCENT} opacity={0.1} />}
            <path d={line} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {last && <circle cx={xAt(n - 1)} cy={yAt(last.y)} r={4} fill={ACCENT} stroke="#fff" strokeWidth={2} />}
          </>
        )}
        {hover != null && kind !== 'bar' && <line x1={xAt(hover)} x2={xAt(hover)} y1={pad.t} y2={yAt(0)} stroke="#CBD5E1" strokeWidth={1} />}
        {hover != null && kind !== 'bar' && <circle cx={xAt(hover)} cy={yAt(points[hover].y)} r={4} fill={ACCENT} stroke="#fff" strokeWidth={2} />}
      </svg>
      {hover != null && points[hover] && (
        <div className="chart-tip" style={{ left: Math.min(width - 120, Math.max(0, xAt(hover) - 50)), top: 0 }}>
          <b className="num">{format(points[hover].y)}</b>
          <span>{points[hover].label}</span>
        </div>
      )}
    </div>
  );
}

/** Card wrapper with a chart ↔ table toggle (tables keep every value reachable). */
export function ChartCard({ title, value, subtitle, points, format, children }: { title: string; value: ReactNode; subtitle: string; points: Point[]; format: (n: number) => string; children: ReactNode }) {
  const [table, setTable] = useState(false);
  return (
    <section className="card card-pad chart-card">
      <header className="card-head">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <div className="chart-value num">{value}</div>
      </header>
      {table ? (
        <div className="chart-table">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th className="r">Value</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.x}>
                  <td>{p.label}</td>
                  <td className="r num">{format(p.y)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
      <button className="link-btn chart-toggle" onClick={() => setTable(!table)}>
        {table ? 'Show chart' : 'Show as table'}
      </button>
    </section>
  );
}
