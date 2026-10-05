import { STATUS_COLORS, STATUS_LABEL, IDLE_COLORS, IDLE_LABEL } from '../core/format';
import { VEHICLE_STATUSES } from '../contracts/types';
import { useFleetStore } from '../store/fleetStore';
import { useServices } from '../store/servicesContext';

export function MapControls() {
  const showLabels = useFleetStore((s) => s.showLabels);
  const showZones = useFleetStore((s) => s.showZones);
  const showTrails = useFleetStore((s) => s.showTrails);
  const following = useFleetStore((s) => s.following);
  const selected = useFleetStore((s) => s.selectedVehicleId);
  const { camera, toggle } = useFleetStore.getState();
  return (
    <div className="map-controls">
      <div className="group">
        <span className="glabel">Camera</span>
        <button onClick={() => camera({ kind: 'preset', preset: 'REGION' })}>Region</button>
        <button onClick={() => camera({ kind: 'preset', preset: 'CITY' })}>City</button>
        <button onClick={() => camera({ kind: 'preset', preset: 'OVERVIEW' })}>Overview</button>
        <button onClick={() => camera({ kind: 'preset', preset: 'BASE' })}>Base</button>
        <button className={following && selected ? 'on' : ''} disabled={!selected} onClick={() => (following ? toggle('following') : selected && camera({ kind: 'vehicle', vehicleId: selected }))}>
          Follow
        </button>
      </div>
      <div className="group">
        <span className="glabel">Layers</span>
        <button className={showLabels ? 'on' : ''} onClick={() => toggle('showLabels')}>
          Labels
        </button>
        <button className={showZones ? 'on' : ''} onClick={() => toggle('showZones')}>
          Demand zones
        </button>
        <button className={showTrails ? 'on' : ''} onClick={() => toggle('showTrails')}>
          GPS trail
        </button>
      </div>
      <div className="legend">
        {VEHICLE_STATUSES.map((s) => (
          <span key={s}>
            <i style={{ background: STATUS_COLORS[s] }} />
            {STATUS_LABEL[s]}
          </span>
        ))}
        <span className="sep" />
        {(['NORMAL', 'ATTENTION', 'WARNING', 'CRITICAL'] as const).map((l) => (
          <span key={l}>
            <i className="sq" style={{ background: IDLE_COLORS[l] }} />
            {IDLE_LABEL[l]}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Required credit for the OpenStreetMap / Overture / building-footprint data. */
export function MapAttribution() {
  const { mapService } = useServices();
  return <div className="map-attribution">Map data {mapService.network.attribution}</div>;
}
