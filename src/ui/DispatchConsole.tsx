import { ArrowDownUp, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatAgo, formatINR, shortId } from '../core/format';
import type { DispatchResult, NamedPlace, VehicleType } from '../contracts/types';
import { useFleetStore } from '../store/fleetStore';
import { useServices } from '../store/servicesContext';
import { StatusPill } from './common';

/** "New ride request": request → recommendation → assignment, then watch it on the map. */
export function DispatchConsole() {
  const open = useFleetStore((s) => s.dispatchOpen);
  if (!open) return null;
  return <Console />;
}

function Console() {
  const { mapService, dispatchService } = useServices();
  const vehicleMap = useFleetStore((s) => s.vehicleMap);
  const bookings = useFleetStore((s) => s.bookings);
  const now = useFleetStore((s) => s.now);
  const { set, showOnMap } = useFleetStore.getState();
  const places = mapService.places().filter((p) => p.name !== 'ZenCabs Base');
  const [pickup, setPickup] = useState(places.find((p) => p.name === 'Jammu Airport')?.name ?? places[0]?.name ?? '');
  const [dest, setDest] = useState(places.find((p) => p.name === 'Raghunath Temple')?.name ?? places[1]?.name ?? '');
  const [customer, setCustomer] = useState('Walk-in customer');
  const [pref, setPref] = useState<VehicleType | ''>('');
  const [result, setResult] = useState<DispatchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const close = () => set({ dispatchOpen: false });

  useEffect(() => {
    setResult(null);
    setErr(null);
  }, [pickup, dest, pref]);

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
        showOnMap(vehicleId);
      } else setErr('That car is no longer available. Find the best car again.');
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const pending = bookings.filter((b) => b.status === 'PENDING');

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal dispatch" role="dialog" aria-label="New ride request" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), close())}>
        <header className="modal-head">
          <div>
            <h2>New ride request</h2>
            <p>We rank free cars by pickup time, idle time and charge.</p>
          </div>
          <button className="icon-btn" onClick={close} aria-label="Close">
            <X size={20} />
          </button>
        </header>
        <div className="modal-body">
          <div className="route-fields">
            <label className="field">
              <span>Pickup</span>
              <select value={pickup} onChange={(e) => setPickup(e.target.value)}>
                {places.map((p) => (
                  <option key={p.name}>{p.name}</option>
                ))}
              </select>
            </label>
            <button className="icon-btn swap" aria-label="Swap pickup and destination" onClick={() => (setPickup(dest), setDest(pickup))}>
              <ArrowDownUp size={18} />
            </button>
            <label className="field">
              <span>Destination</span>
              <select value={dest} onChange={(e) => setDest(e.target.value)}>
                {places.map((p) => (
                  <option key={p.name}>{p.name}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-grid">
            <label className="field">
              <span>Customer</span>
              <input value={customer} onChange={(e) => setCustomer(e.target.value)} />
            </label>
            <label className="field">
              <span>Vehicle type</span>
              <select value={pref} onChange={(e) => setPref(e.target.value as VehicleType | '')}>
                <option value="">Any</option>
                <option value="SEDAN">Sedan</option>
                <option value="SUV">SUV</option>
                <option value="EV_SEDAN">EV</option>
                <option value="HATCHBACK">Hatchback</option>
              </select>
            </label>
          </div>
          {pickup === dest && <div className="note">Pickup and destination are the same.</div>}
          {err && <div className="note bad">{err}</div>}

          {result && (
            <div className="candidates">
              <div className="cand-summary">
                <b>{result.candidates.length ? `${result.candidates.length} cars can take this ride` : 'No car is free'}</b>
                <span className="muted">Estimated fare {formatINR(result.booking.estimatedFare)}</span>
              </div>
              {!result.candidates.length && <p className="muted">The request will wait as unserved demand until a car frees up.</p>}
              {result.candidates.map((c, i) => {
                const v = vehicleMap[c.vehicleId];
                return (
                  <div key={c.vehicleId} className={`cand ${i === 0 ? 'best' : ''}`}>
                    <div className="cand-head">
                      <span className="cand-id">
                        <b>{shortId(c.vehicleId)}</b>
                        {i === 0 && <span className="tag">Best match</span>}
                      </span>
                      <span className="eta num">{c.etaMinutes} min</span>
                    </div>
                    <div className="cand-meta">
                      <span className="muted">{v?.driverName}</span>
                      {v && <StatusPill status={v.status} />}
                      <span className="faint">{c.distanceKm} km away</span>
                    </div>
                    <ul className="reasons">
                      {c.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                    <button className={`btn ${i === 0 ? 'primary' : ''} wide`} disabled={busy} onClick={() => assign(c.vehicleId)}>
                      Assign {shortId(c.vehicleId)}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {pending.length > 0 && (
            <div className="pending">
              <h4>
                Waiting for a car <span className="count alert">{pending.length}</span>
              </h4>
              <ul>
                {pending.slice(0, 6).map((b) => (
                  <li key={b.bookingId}>
                    <span>
                      {b.pickup.name} <span className="faint">→ {b.destination.name}</span>
                    </span>
                    <span className="num muted">{formatAgo(now - b.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <footer className="modal-foot">
          <button className="btn ghost" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || pickup === dest} onClick={preview}>
            {busy ? 'Searching…' : result ? 'Search again' : 'Find best car'}
          </button>
        </footer>
      </div>
    </div>
  );
}
