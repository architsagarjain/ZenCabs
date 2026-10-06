import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { formatDuration, IDLE_COLORS, IDLE_LABEL, parkingIdleLevel, STATUS_COLORS, STATUS_LABEL } from '../core/format';
import type { VehicleStatus } from '../contracts/types';

/** Darkens a status colour so it stays legible as text on white (WCAG AA). */
export function onLight(c: string) {
  return `color-mix(in srgb, ${c} 62%, #111827)`;
}

export function StatusPill({ status }: { status: VehicleStatus; small?: boolean }) {
  const c = STATUS_COLORS[status];
  return (
    <span className="pill" style={{ color: onLight(c), background: `color-mix(in srgb, ${c} 12%, white)` }}>
      <i style={{ background: c }} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function IdleBadge({ ms }: { ms: number | null }) {
  if (ms == null) return null;
  const lvl = parkingIdleLevel(ms);
  const c = IDLE_COLORS[lvl];
  return (
    <span className={`idle-badge lvl-${lvl.toLowerCase()}`} style={{ color: onLight(c), background: `color-mix(in srgb, ${c} 13%, white)` }}>
      <i className="dot" style={{ background: c }} />
      {IDLE_LABEL[lvl]} · {formatDuration(ms)}
    </span>
  );
}

export function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span className="v">{children}</span>
    </div>
  );
}

export function Meter({ pct, color, label }: { pct: number; color: string; label: string }) {
  return (
    <div className="meter" role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="meter-head">
        <span>{label}</span>
        <b className="num">{Math.round(pct)}%</b>
      </div>
      <div className="meter-bar" style={{ background: `color-mix(in srgb, ${color} 14%, white)` }}>
        <div style={{ width: `${Math.max(2, Math.min(100, pct))}%`, background: color }} />
      </div>
    </div>
  );
}

/** Card section with title / supporting text / optional action (DESIGN.md §14). */
export function Card({ title, subtitle, action, count, alertCount, children, className = '' }: { title: string; subtitle?: string; action?: ReactNode; count?: number; alertCount?: boolean; children: ReactNode; className?: string }) {
  return (
    <section className={`card card-pad ${className}`}>
      <header className="card-head">
        <div>
          <h3>
            {title}
            {count != null && <span className={`count ${alertCount && count > 0 ? 'alert' : ''}`}>{count}</span>}
          </h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

/** 12-point sparkline: history in muted grey, current point in the accent. */
export function Sparkline({ values, color = '#1E63C4' }: { values: number[]; color?: string }) {
  if (values.length < 2) return <svg className="spark" width={72} height={28} aria-hidden />;
  const w = 72;
  const h = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (w - 6) + 3, h - 4 - ((v - min) / span) * (h - 8)] as const);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const last = pts[pts.length - 1];
  return (
    <svg className="spark" width={w} height={h} aria-hidden>
      <path d={d} fill="none" stroke="#CBD5E1" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={4} fill={color} stroke="#fff" strokeWidth={2} />
    </svg>
  );
}

/**
 * KPI card: metric · value · context · trend (DESIGN.md §15).
 * `upIsGood` decides whether a rise is coloured as good or bad.
 */
export function KpiCard({
  label,
  value,
  context,
  delta,
  upIsGood = true,
  spark,
  active,
  onClick,
  tone,
}: {
  label: string;
  value: ReactNode;
  context: ReactNode;
  delta?: { delta: number; sinceMs: number; format?: (n: number) => string } | null;
  upIsGood?: boolean;
  spark?: number[];
  active?: boolean;
  onClick?: () => void;
  tone?: 'attention';
}) {
  const d = delta?.delta ?? 0;
  const good = d === 0 ? null : d > 0 === upIsGood;
  const Icon = d > 0 ? ArrowUpRight : d < 0 ? ArrowDownRight : Minus;
  const fmt = delta?.format ?? ((n: number) => Math.abs(n).toLocaleString('en-IN'));
  const since = delta ? Math.round(delta.sinceMs / 60_000) : 0;
  return (
    <button className={`kpi card ${active ? 'active' : ''} ${tone ?? ''}`} onClick={onClick} disabled={!onClick} aria-pressed={active}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-main">
        <span className="kpi-value">{value}</span>
        {spark && <Sparkline values={spark} />}
      </span>
      <span className="kpi-foot">
        {delta && (
          <span className={`kpi-delta ${good == null ? '' : good ? 'up-good' : 'up-bad'}`} title={`Change vs ${since} min ago`}>
            <Icon size={14} strokeWidth={2.25} />
            {fmt(d)}
          </span>
        )}
        <span className="kpi-context">{context}</span>
      </span>
    </button>
  );
}

export function Avatar({ src, name, size = 32 }: { src?: string | null; name: string; size?: number }) {
  return src ? <img className="avatar" src={src} alt="" width={size} height={size} /> : <span className="avatar" style={{ width: size, height: size }}>{name[0]}</span>;
}
