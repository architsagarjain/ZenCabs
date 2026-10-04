import { Stars } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Bloom, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { Suspense, useRef } from 'react';
import * as THREE from 'three';
import { useFleetStore } from '../store/fleetStore';
import { ServicesContext, useServices } from '../store/servicesContext';
import { CameraRig, ShadowFollower } from './CameraRig';
import { City } from './City';
import { PendingRequests, RouteOverlay, ZonesOverlay } from './Overlays';
import { ParkingLotTwin } from './ParkingLotTwin';
import { Vehicles } from './Vehicles';

export function FleetScene() {
  const services = useServices();
  const select = useFleetStore((s) => s.select);
  return (
    <Canvas
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={[1, 1.5]}
      gl={{ antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance' }}
      camera={{ fov: 42, near: 1, far: 20000, position: [1500, 2300, 3100] }}
      onPointerMissed={() => select(null)}
    >
      {/* Context does not cross the reconciler boundary in every setup — re-provide it. */}
      <ServicesContext.Provider value={services}>
        <World />
      </ServicesContext.Provider>
    </Canvas>
  );
}

function World() {
  const moon = useRef<THREE.DirectionalLight>(null);
  const showZones = useFleetStore((s) => s.showZones);
  return (
    <>
      <color attach="background" args={['#060b14']} />
      <fog attach="fog" args={['#070d18', 2200, 9000]} />
      <ambientLight intensity={0.55} color="#8fa6c8" />
      <hemisphereLight args={['#6b8cc4', '#0b1220', 0.7]} />
      <directionalLight
        ref={moon}
        castShadow
        intensity={1.6}
        color="#c7d7ff"
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-180}
        shadow-camera-right={180}
        shadow-camera-top={180}
        shadow-camera-bottom={-180}
        shadow-camera-near={10}
        shadow-camera-far={1200}
        shadow-bias={-0.0004}
      />
      <ShadowFollower light={moon} />
      <Stars radius={7000} depth={600} count={2500} factor={60} fade speed={0.4} />
      <Suspense fallback={null}>
        <City />
        <ParkingLotTwin />
        <Vehicles />
        <RouteOverlay />
        <PendingRequests />
        {showZones && <ZonesOverlay />}
      </Suspense>
      <CameraRig />
      <EffectComposer multisampling={4}>
        <Bloom intensity={0.85} luminanceThreshold={0.95} luminanceSmoothing={0.25} mipmapBlur radius={0.7} />
        <Vignette offset={0.25} darkness={0.55} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    </>
  );
}
