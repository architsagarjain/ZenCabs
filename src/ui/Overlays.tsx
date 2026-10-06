/** Global overlays: critical-alert toasts, call-driver dialog, mobile settings sheet. */
import { AlertOctagon, Phone, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { shortId } from '../core/format';
import type { Alert } from '../contracts/types';
import { useFleetStore } from '../store/fleetStore';
import { useServices } from '../store/servicesContext';
import { ALERT_TITLE } from './attention';
import { Avatar } from './common';
import { LayersPopover } from './dashboard/Dashboard';
import { DataModeControl } from './layout/Shell';

export function Toasts() {
  const { alertService } = useServices();
  const showOnMap = useFleetStore((s) => s.showOnMap);
  const [items, setItems] = useState<Alert[]>([]);
  useEffect(() => {
    const ready = performance.now() + 4000; // skip the initial burst on load
    return alertService.onAlert((a) => {
      if (a.severity !== 'CRITICAL' || performance.now() < ready) return;
      setItems((xs) => [a, ...xs].slice(0, 3));
      setTimeout(() => setItems((xs) => xs.filter((x) => x.alertId !== a.alertId)), 7000);
    });
  }, [alertService]);
  const dismiss = (id: string) => setItems((xs) => xs.filter((x) => x.alertId !== id));
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((a) => (
        <div key={a.alertId} className="toast">
          <AlertOctagon size={20} className="toast-icon" />
          <div className="toast-body">
            <b>
              {ALERT_TITLE[a.type] ?? 'Needs attention'}
              {a.vehicleId && ` · ${shortId(a.vehicleId)}`}
            </b>
            <span>{a.message}</span>
            {a.vehicleId && (
              <button className="link-btn" onClick={() => (showOnMap(a.vehicleId!), dismiss(a.alertId))}>
                Show on map
              </button>
            )}
          </div>
          <button className="icon-btn sm" aria-label="Dismiss" onClick={() => dismiss(a.alertId)}>
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function CallDriverModal() {
  const { driverService } = useServices();
  const id = useFleetStore((s) => s.callDriverId);
  const d = useFleetStore((s) => (id ? s.drivers[id] : undefined));
  const set = useFleetStore((s) => s.set);
  if (!d) return null;
  const close = () => set({ callDriverId: null });
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal call" role="dialog" aria-label={`Call ${d.name}`} onClick={(e) => e.stopPropagation()}>
        <Avatar src={d.photo} name={d.name} size={72} />
        <h2>{d.name}</h2>
        <div className="num call-number">{d.phone}</div>
        <p className="muted small">
          Driving {d.assignedVehicleId ? shortId(d.assignedVehicleId) : 'no vehicle'}. Telephony isn’t connected in this prototype, so the call opens on this device.
        </p>
        <div className="modal-actions">
          <button className="btn ghost" onClick={close}>
            Close
          </button>
          <a className="btn primary" href={driverService.callUri(d)}>
            <Phone size={18} /> Call now
          </a>
        </div>
      </div>
    </div>
  );
}

/** Mobile-only: simulation speed and map layers, out of the way of the map. */
export function SettingsSheet() {
  const open = useFleetStore((s) => s.settingsOpen);
  const { simulation } = useServices();
  const simSpeed = useFleetStore((s) => s.simSpeed);
  const set = useFleetStore((s) => s.set);
  if (!open) return null;
  const close = () => set({ settingsOpen: false });
  return (
    <div className="modal-backdrop sheet-backdrop" onClick={close}>
      <div className="modal settings-sheet" role="dialog" aria-label="Map settings" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2>Map settings</h2>
          </div>
          <button className="icon-btn" onClick={close} aria-label="Close">
            <X size={20} />
          </button>
        </header>
        <div className="modal-body">
          <div className="settings-row">
            <span>
              <b>Data source</b>
            </span>
            <DataModeControl compact />
          </div>
          {simulation && (
            <div className="settings-row stack">
              <b>Simulation speed</b>
              <div className="segmented wide" role="group" aria-label="Simulation speed">
                {[1, 3, 10, 20].map((s) => (
                  <button
                    key={s}
                    className={simSpeed === s ? 'active' : ''}
                    onClick={() => {
                      simulation.setSpeed(s);
                      set({ simSpeed: s });
                    }}
                  >
                    {s}×
                  </button>
                ))}
              </div>
            </div>
          )}
          <h4 className="settings-group">Map layers</h4>
          <LayersPopover />
        </div>
      </div>
    </div>
  );
}
