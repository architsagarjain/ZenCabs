/** ⌘K command palette: find a vehicle, driver, bay or place and jump to it, or run a quick action. */
import { Car, CornerDownLeft, Lightbulb, MapPin, Plus, Search, SquareParking, Users, X, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { shortId } from '../core/format';
import { toScene } from '../core/geo';
import { useFleetStore } from '../store/fleetStore';
import { useServices } from '../store/servicesContext';
import { StatusPill } from './common';

interface Item {
  id: string;
  group: 'Actions' | 'Vehicles' | 'Drivers' | 'Places';
  icon: LucideIcon;
  title: string;
  hint?: string;
  status?: Parameters<typeof StatusPill>[0]['status'];
  keywords: string;
  run(): void;
}

export function CommandPalette() {
  const open = useFleetStore((s) => s.paletteOpen);
  if (!open) return null;
  return <Palette />;
}

function Palette() {
  const { mapService } = useServices();
  const vehicles = useFleetStore((s) => s.vehicles);
  const drivers = useFleetStore((s) => s.drivers);
  const { set, showOnMap, select, camera, setPage, setFilter } = useFleetStore.getState();
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const close = () => set({ paletteOpen: false });

  useEffect(() => inputRef.current?.focus(), []);

  const all = useMemo<Item[]>(() => {
    const flyTo = (lat: number, lng: number, distance = 900) => {
      const p = toScene(lat, lng);
      set({ page: 'dashboard', following: false });
      camera({ kind: 'point', point: { x: p.x, z: p.z, distance } });
    };
    const items: Item[] = [
      { id: 'a:new', group: 'Actions', icon: Plus, title: 'New ride request', keywords: 'book dispatch new ride request booking', run: () => set({ dispatchOpen: true }) },
      { id: 'a:base', group: 'Actions', icon: SquareParking, title: 'Show the base lot', keywords: 'base lot parking bays', run: () => (set({ page: 'dashboard' }), camera({ kind: 'preset', preset: 'BASE' })) },
      { id: 'a:city', group: 'Actions', icon: MapPin, title: 'Show the whole city', keywords: 'city jammu overview map', run: () => (set({ page: 'dashboard' }), camera({ kind: 'preset', preset: 'CITY' })) },
      { id: 'a:parked', group: 'Actions', icon: Car, title: 'Cars parked over 1 hour', keywords: 'parked idle long hour', run: () => (setPage('fleet'), setFilter('PARKED_1H')) },
      { id: 'a:drivers', group: 'Actions', icon: Users, title: 'Open drivers', keywords: 'drivers shift', run: () => setPage('drivers') },
      { id: 'a:insights', group: 'Actions', icon: Lightbulb, title: 'Open insights', keywords: 'insights demand gaps revenue', run: () => setPage('insights') },
    ];
    for (const v of vehicles) {
      items.push({
        id: `v:${v.vehicleId}`,
        group: 'Vehicles',
        icon: Car,
        title: `${shortId(v.vehicleId)} · ${v.registrationNumber}`,
        hint: [v.driverName, v.vehicleModel, v.parkingBay && `Bay ${v.parkingBay}`].filter(Boolean).join(' · '),
        status: v.status,
        keywords: [v.vehicleId, shortId(v.vehicleId), v.registrationNumber, v.registrationNumber.replace(/\s/g, ''), v.driverName, v.vehicleModel, v.parkingBay, v.parkingBay && `bay ${v.parkingBay}`].filter(Boolean).join(' '),
        run: () => showOnMap(v.vehicleId),
      });
    }
    for (const d of Object.values(drivers)) {
      items.push({
        id: `d:${d.driverId}`,
        group: 'Drivers',
        icon: Users,
        title: d.name,
        hint: `${d.assignedVehicleId ? shortId(d.assignedVehicleId) : 'No vehicle'} · ${d.phone}`,
        keywords: `${d.name} ${d.phone} ${d.driverId}`,
        run: () => d.assignedVehicleId && select(d.assignedVehicleId, { fly: false, tab: 'DRIVER' }),
      });
    }
    for (const z of mapService.zones) {
      items.push({ id: `z:${z.zoneId}`, group: 'Places', icon: MapPin, title: z.name, hint: 'Area', keywords: `${z.name} area zone`, run: () => (set({ showZones: true }), flyTo(z.center.lat, z.center.lng, 1600)) });
    }
    const zoneNames = new Set(mapService.zones.map((z) => z.name));
    for (const p of mapService.places()) {
      if (zoneNames.has(p.name)) continue;
      items.push({ id: `p:${p.name}`, group: 'Places', icon: MapPin, title: p.name, hint: 'Landmark', keywords: p.name, run: () => flyTo(p.lat, p.lng) });
    }
    return items;
    // Vehicle list identity changes every tick; rebuilding is cheap (≈200 items).
  }, [vehicles, drivers, mapService, set, camera, showOnMap, select, setPage, setFilter]);

  const results = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return all.filter((i) => i.group === 'Actions');
    const scored: { i: Item; s: number }[] = [];
    for (const i of all) {
      const hay = `${i.title} ${i.keywords}`.toLowerCase();
      if (!terms.every((t) => hay.includes(t))) continue;
      const title = i.title.toLowerCase();
      scored.push({ i, s: (title.startsWith(terms[0]) ? 0 : title.includes(terms[0]) ? 1 : 2) + (i.group === 'Actions' ? 0.5 : 0) });
    }
    return scored
      .sort((a, b) => a.s - b.s)
      .slice(0, 30)
      .map((x) => x.i);
  }, [q, all]);

  useEffect(() => setCursor(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const run = (i: Item | undefined) => {
    if (!i) return;
    close();
    i.run();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') (e.preventDefault(), setCursor((c) => Math.min(results.length - 1, c + 1)));
    else if (e.key === 'ArrowUp') (e.preventDefault(), setCursor((c) => Math.max(0, c - 1)));
    else if (e.key === 'Enter') (e.preventDefault(), run(results[cursor]));
    else if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), close());
  };

  let lastGroup = '';
  return (
    <div className="modal-backdrop palette-backdrop" onClick={close}>
      <div className="palette" role="dialog" aria-label="Search" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="palette-input">
          <Search size={20} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search vehicles, drivers, bays or places"
            aria-label="Search"
            aria-controls="palette-results"
            aria-activedescendant={results[cursor] ? `pi-${cursor}` : undefined}
          />
          <button className="icon-btn" onClick={close} aria-label="Close search">
            <X size={20} />
          </button>
        </div>
        <ul className="palette-results" id="palette-results" role="listbox" ref={listRef}>
          {results.map((i, n) => {
            const head = i.group !== lastGroup ? i.group : null;
            lastGroup = i.group;
            const Icon = i.icon;
            return (
              <li key={i.id} role="presentation">
                {head && <div className="palette-group">{head}</div>}
                <button
                  id={`pi-${n}`}
                  data-i={n}
                  role="option"
                  aria-selected={n === cursor}
                  className={`palette-item ${n === cursor ? 'active' : ''}`}
                  onMouseMove={() => n !== cursor && setCursor(n)}
                  onClick={() => run(i)}
                >
                  <Icon size={18} className="pi-icon" />
                  <span className="pi-text">
                    <b>{i.title}</b>
                    {i.hint && <span>{i.hint}</span>}
                  </span>
                  {i.status && <StatusPill status={i.status} />}
                  {n === cursor && <CornerDownLeft size={16} className="pi-enter" />}
                </button>
              </li>
            );
          })}
          {!results.length && <li className="empty">Nothing matches “{q}”.</li>}
        </ul>
        <div className="palette-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> to move
          </span>
          <span>
            <kbd>↵</kbd> to open
          </span>
          <span>
            <kbd>esc</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}
