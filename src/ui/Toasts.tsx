import { useEffect, useState } from 'react';
import type { Alert } from '../contracts/types';
import { useFleetStore } from '../store/fleetStore';
import { useServices } from '../store/servicesContext';

/** Pops CRITICAL alerts as they arrive. */
export function Toasts() {
  const { alertService } = useServices();
  const select = useFleetStore((s) => s.select);
  const [items, setItems] = useState<Alert[]>([]);
  useEffect(() => {
    const ready = performance.now() + 4000; // skip the initial burst on load
    return alertService.onAlert((a) => {
      if (a.severity !== 'CRITICAL' || performance.now() < ready) return;
      setItems((xs) => [a, ...xs].slice(0, 3));
      setTimeout(() => setItems((xs) => xs.filter((x) => x.alertId !== a.alertId)), 7000);
    });
  }, [alertService]);
  return (
    <div className="toasts">
      {items.map((a) => (
        <div key={a.alertId} className="toast" onClick={() => a.vehicleId && select(a.vehicleId)}>
          <b>⛔ {a.type.replace(/_/g, ' ')}</b>
          <span>{a.message}</span>
        </div>
      ))}
    </div>
  );
}
