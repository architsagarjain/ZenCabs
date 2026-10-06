import { Canvas } from '@react-three/fiber';
import { Bloom, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { Suspense, useRef } from 'react';
import * as THREE from 'three';
import { SCENE } from '../config/theme';
import { useFleetStore } from '../store/fleetStore';
import { ServicesContext, useServices } from '../store/servicesContext';
import { useLowPower } from '../store/useBreakpoint';
import { CameraRig, DoubleClickZoom, DynamicFog, ShadowFollower } from './CameraRig';
import { City } from './City';
import { PendingRequests, RouteOverlay, ZonesOverlay } from './Overlays';
import { ParkingLotTwin } from './ParkingLotTwin';
import { Vehicles } from './Vehicles';

export function FleetScene({ active = true }: { active?: boolean }) {
  const services = useServices();
  const select = useFleetStore((s) => s.select);
  const low = useLowPower();
  return (
    <Canvas
      // Rendering pauses while another page is open (the scene stays mounted).
      frameloop={active ? 'always' : 'never'}
      shadows={low ? false : { type: THREE.PCFShadowMap }}
      dpr={low ? [1, 1.25] : [1, 1.5]}
      gl={{ antialias: low, logarithmicDepthBuffer: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.NeutralToneMapping;
      }}
      camera={{ fov: 42, near: 1, far: 160000, position: [2600, 6200, 7600] }}
      onPointerMissed={() => select(null)}
    >
      {/* Context does not cross the reconciler boundary in every setup — re-provide it. */}
      <ServicesContext.Provider value={services}>
        <World low={low} />
      </ServicesContext.Provider>
    </Canvas>
  );
}

function World({ low }: { low: boolean }) {
  const sun = useRef<THREE.DirectionalLight>(null);
  const showZones = useFleetStore((s) => s.showZones);
  return (
    <>
      <color attach="background" args={[SCENE.sky]} />
      <fog attach="fog" args={[SCENE.fog, SCENE.fogNear, SCENE.fogFar]} />
      <ambientLight intensity={0.9} color="#ffffff" />
      <hemisphereLight args={['#ffffff', '#c9d3dc', 1.1]} />
      <directionalLight
        ref={sun}
        castShadow
        intensity={2.4}
        color="#fff8ee"
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-180}
        shadow-camera-right={180}
        shadow-camera-top={180}
        shadow-camera-bottom={-180}
        shadow-camera-near={10}
        shadow-camera-far={1200}
        shadow-bias={-0.0004}
      />
      <ShadowFollower light={sun} />
      <DynamicFog />
      <DoubleClickZoom />
      <Suspense fallback={null}>
        <City />
        <ParkingLotTwin />
        <Vehicles />
        <RouteOverlay />
        <PendingRequests />
        {showZones && <ZonesOverlay />}
      </Suspense>
      <CameraRig />
      {/* Post-processing is desktop-only; phones render straight to screen with neutral tone mapping. */}
      {!low && (
        <EffectComposer multisampling={4}>
          <Bloom intensity={0.35} luminanceThreshold={1.15} luminanceSmoothing={0.2} mipmapBlur radius={0.5} />
          <Vignette offset={0.35} darkness={0.18} />
          <ToneMapping mode={ToneMappingMode.NEUTRAL} />
        </EffectComposer>
      )}
    </>
  );
}
