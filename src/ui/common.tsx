import type { ReactNode } from 'react';
import { IDLE_COLORS, IDLE_LABEL, STATUS_COLORS, STATUS_LABEL, parkingIdleLevel, formatDuration } from '../core/format';
import type { VehicleStatus } from '../contracts/types';

export function StatusPill({ status, small }: { status: VehicleStatus; small?: boolean }) {
  const c = STATUS_COLORS[status];
  return (
    <span className={`pill ${small ? 'sm' : ''}`} style={{ color: c, borderColor: c + '66', background: c + '1f' }}>
      <i style={{ background: c }} />
      {small ? STATUS_LABEL[status] : status.replace(/_/g, ' ')}
    </span>
  );
}

export function IdleBadge({ ms }: { ms: number | null }) {
  if (ms == null) return null;
  const lvl = parkingIdleLevel(ms);
  const c = IDLE_COLORS[lvl];
  return (
    <span className={`idle-badge lvl-${lvl.toLowerCase()}`} style={{ color: c, borderColor: c + '66', background: c + '1a' }}>
      {formatDuration(ms)} · {IDLE_LABEL[lvl]}
    </span>
  );
}

export function Row({ k, children, mono }: { k: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span className={`v ${mono ? 'mono' : ''}`}>{children}</span>
    </div>
  );
}

export function Meter({ pct, color, label }: { pct: number; color: string; label: string }) {
  return (
    <div className="meter">
      <div className="meter-head">
        <span>{label}</span>
        <b>{Math.round(pct)}%</b>
      </div>
      <div className="meter-bar">
        <div style={{ width: `${Math.max(2, Math.min(100, pct))}%`, background: color }} />
      </div>
    </div>
  );
}

export function Card({ title, subtitle, children, icon, accent }: { title: string; subtitle?: string; children: ReactNode; icon?: string; accent?: string }) {
  return (
    <section className="card" style={accent ? { borderTopColor: accent } : undefined}>
      <header>
        {icon && <span className="card-icon">{icon}</span>}
        <div>
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </header>
      <div className="card-body">{children}</div>
    </section>
  );
}
