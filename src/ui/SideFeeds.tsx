import { useState } from 'react';
import { formatAgo, shortId } from '../core/format';
import { useFleetStore } from '../store/fleetStore';
import { useServices } from '../store/servicesContext';

const SEV_ICON = { CRITICAL: '⛔', WARNING: '⚠', INFO: 'ℹ' } as const;
const KIND_ICON = { REQUEST: '📱', ASSIGNED: '🧭', STARTED: '🚕', COMPLETED: '✅', STATUS: '↩', PARKING: 'Ⓟ' } as const;

export function AlertsPanel() {
  const { alertService } = useServices();
  const alerts = useFleetStore((s) => s.alerts);
  const now = useFleetStore((s) => s.now);
  const select = useFleetStore((s) => s.select);
  const [showResolved, setShowResolved] = useState(false);
  const list = alerts.filter((a) => showResolved || !a.resolvedAt);
  const crit = alerts.filter((a) => !a.resolvedAt && a.severity === 'CRITICAL').length;
  return (
    <section className="feed alerts-feed">
      <div className="feed-head">
        <h3>
          Alerts <span className="count">{alerts.filter((a) => !a.resolvedAt).length}</span>
          {crit > 0 && <span className="count crit">{crit} critical</span>}
        </h3>
        <label className="small muted">
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> resolved
        </label>
      </div>
      <ul>
        {list.slice(0, 60).map((a) => (
          <li key={a.alertId} className={`sev-${a.severity.toLowerCase()} ${a.resolvedAt ? 'resolved' : ''} ${a.acknowledged ? 'ack' : ''}`} onClick={() => a.vehicleId && select(a.vehicleId)}>
            <span className="ic">{SEV_ICON[a.severity]}</span>
            <div>
              <div>{a.message}</div>
              <div className="muted small">
                {a.type.replace(/_/g, ' ').toLowerCase()} · {formatAgo(now - a.createdAt)}
              </div>
            </div>
            {!a.acknowledged && !a.resolvedAt && (
              <button
                className="ack"
                onClick={(e) => {
                  e.stopPropagation();
                  alertService.acknowledge(a.alertId);
                }}
              >
                Ack
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ActivityFeed() {
  const activity = useFleetStore((s) => s.activity);
  const now = useFleetStore((s) => s.now);
  const select = useFleetStore((s) => s.select);
  return (
    <section className="feed activity-feed">
      <div className="feed-head">
        <h3>Dispatch activity</h3>
        <span className="live">● live</span>
      </div>
      <ul>
        {activity.slice(0, 40).map((a) => (
          <li key={a.id} onClick={() => a.vehicleId && select(a.vehicleId)} className={a.vehicleId ? 'clickable' : ''}>
            <span className="ic">{KIND_ICON[a.kind]}</span>
            <div>
              <div>{a.text}</div>
              <div className="muted small">{formatAgo(now - a.at)}</div>
            </div>
          </li>
        ))}
        {!activity.length && <li className="muted">Waiting for events…</li>}
      </ul>
    </section>
  );
}

export function CallDriverModal() {
  const { driverService } = useServices();
  const id = useFleetStore((s) => s.callDriverId);
  const d = useFleetStore((s) => (id ? s.drivers[id] : undefined));
  const set = useFleetStore((s) => s.set);
  if (!d) return null;
  return (
    <div className="modal-backdrop" onClick={() => set({ callDriverId: null })}>
      <div className="modal call" onClick={(e) => e.stopPropagation()}>
        <img src={d.photo} alt="" />
        <h2>{d.name}</h2>
        <div className="mono big">{d.phone}</div>
        <p className="muted small">
          Vehicle {d.assignedVehicleId ? shortId(d.assignedVehicleId) : '—'} · prototype: telephony integration not connected. Use the link below to call from this device.
        </p>
        <div className="row-btns">
          <a className="btn primary" href={driverService.callUri(d)}>
            📞 Call now
          </a>
          <button className="btn" onClick={() => set({ callDriverId: null })}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
