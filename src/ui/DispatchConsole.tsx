import { useEffect, useState } from 'react';
import { formatAgo, formatINR, shortId } from '../core/format';
import type { DispatchResult, NamedPlace, VehicleType } from '../contracts/types';
import { useFleetStore } from '../store/fleetStore';
import { useServices } from '../store/servicesContext';
import { StatusPill } from './common';

/** "New ride request" console: request → recommendation → assignment, then watch it in 3D. */
export function DispatchConsole() {
  const { mapService, dispatchService } = useServices();
  const open = useFleetStore((s) => s.dispatchOpen);
  const vehicleMap = useFleetStore((s) => s.vehicleMap);
  const bookings = useFleetStore((s) => s.bookings);
  const now = useFleetStore((s) => s.now);
  const { set, select } = useFleetStore.getState();
  const places = mapService.places().filter((p) => p.name !== 'ZenCabs Base');
  const [pickup, setPickup] = useState('Jammu Airport');
  const [dest, setDest] = useState('Raghunath Temple');
  const [customer, setCustomer] = useState('Walk-in customer');
  const [pref, setPref] = useState<VehicleType | ''>('');
  const [result, setResult] = useState<DispatchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setResult(null);
    setErr(null);
  }, [pickup, dest, pref]);

  if (!open) return null;
  const place = (n: string): NamedPlace => places.find((p) => p.name === n)!;
  const req = () => ({ pickup: place(pickup), destination: place(dest), customerName: customer, vehicleTypePreference: pref || null });

  const preview = async () => {
    setBusy(true);
    setErr(null);
    try {
      setResult(await dispatchService.recommend(req()));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const assign = async (vehicleId: string) => {
    setBusy(true);
    try {
      const r = await dispatchService.dispatch({ ...req(), vehicleId });
      if (r.assigned) {
        set({ dispatchOpen: false, showRoute: true });
        select(vehicleId);
        setResult(null);
      } else setErr('Vehicle is no longer available — refresh the recommendation.');
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const pending = bookings.filter((b) => b.status === 'PENDING');

  return (
    <div className="modal-backdrop" onClick={() => set({ dispatchOpen: false })}>
      <div className="modal dispatch" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>New ride request</h2>
          <button className="icon-btn" onClick={() => set({ dispatchOpen: false })}>
            ✕
          </button>
        </div>
        <div className="form-grid">
          <label>
            Pickup
            <select value={pickup} onChange={(e) => setPickup(e.target.value)}>
              {places.map((p) => (
                <option key={p.name}>{p.name}</option>
              ))}
            </select>
          </label>
          <label>
            Destination
            <select value={dest} onChange={(e) => setDest(e.target.value)}>
              {places.map((p) => (
                <option key={p.name}>{p.name}</option>
              ))}
            </select>
          </label>
          <label>
            Customer
            <input value={customer} onChange={(e) => setCustomer(e.target.value)} />
          </label>
          <label>
            Vehicle type
            <select value={pref} onChange={(e) => setPref(e.target.value as VehicleType | '')}>
              <option value="">Any</option>
              <option value="SEDAN">Sedan</option>
              <option value="SUV">SUV</option>
              <option value="EV_SEDAN">EV</option>
              <option value="HATCHBACK">Hatchback</option>
            </select>
          </label>
        </div>
        <button className="btn primary wide" disabled={busy || pickup === dest} onClick={preview}>
          {busy ? 'Searching…' : 'Find best vehicle'}
        </button>
        {err && <div className="note bad">{err}</div>}
        {result && (
          <div className="candidates">
            {!result.candidates.length && <p className="muted">No vehicle available. The request would queue as unserved demand.</p>}
            {result.candidates.map((c, i) => {
              const v = vehicleMap[c.vehicleId];
              return (
                <div key={c.vehicleId} className={`cand ${i === 0 ? 'best' : ''}`}>
                  <div className="cand-head">
                    {i === 0 && <span className="tag">Recommended</span>}
                    <b>{shortId(c.vehicleId)}</b>
                    <span className="muted">{v?.driverName}</span>
                    {v && <StatusPill status={v.status} small />}
                    <span className="eta">{c.etaMinutes} min</span>
                  </div>
                  <ul className="reasons">
                    {c.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                  <button className={`btn ${i === 0 ? 'primary' : ''}`} disabled={busy} onClick={() => assign(c.vehicleId)}>
                    Assign {shortId(c.vehicleId)}
                  </button>
                </div>
              );
            })}
            <div className="muted small">Estimated fare {formatINR(result.booking.estimatedFare)}</div>
          </div>
        )}
        {pending.length > 0 && (
          <div className="pending">
            <h4>Unassigned requests ({pending.length})</h4>
            {pending.slice(0, 6).map((b) => (
              <div key={b.bookingId} className="ops-row">
                <span>{b.pickup.name}</span>
                <span className="muted">→ {b.destination.name}</span>
                <span className="mono">{formatAgo(now - b.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
