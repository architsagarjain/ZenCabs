import * as THREE from 'three';
import { SCENE } from '../config/theme';

/** sRGB hex → linear vec3 literal for shader injection. */
function glsl(hex: string) {
  const c = new THREE.Color(hex);
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
}

export const sharedMaterials = {
  carBody: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.2 }),
  carLights: new THREE.MeshBasicMaterial({ vertexColors: true }),
};

/** Building material with procedural lit windows computed in world space. */
export function createBuildingMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.75, metalness: 0.05 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vZcWorld;
        varying vec3 vZcNormal;
        varying float vZcSeed;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        mat4 zcM = modelMatrix;
        #ifdef USE_INSTANCING
          zcM = modelMatrix * instanceMatrix;
          vZcSeed = float(gl_InstanceID);
        #else
          vZcSeed = 0.0;
        #endif
        vZcWorld = (zcM * vec4(transformed, 1.0)).xyz;
        vZcNormal = normalize(mat3(zcM) * normal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vZcWorld;
        varying vec3 vZcNormal;
        varying float vZcSeed;
        float zcHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        const vec3 GLASS_LOW = ${glsl(SCENE.buildingGlass)};
        const vec3 GLASS_HIGH = ${glsl(SCENE.buildingGlassHigh)};`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        // Daylight facade: tinted glass bands with a sky-reflection gradient, no emitted light.
        if (abs(vZcNormal.y) < 0.5) {
          float h = abs(vZcNormal.x) > 0.5 ? vZcWorld.z : vZcWorld.x;
          vec2 cell = vec2(floor(h / 3.4), floor((vZcWorld.y - 1.2) / 3.6));
          vec2 f = vec2(fract(h / 3.4), fract((vZcWorld.y - 1.2) / 3.6));
          float win = step(0.16, f.x) * step(f.x, 0.84) * step(0.26, f.y) * step(f.y, 0.8) * step(1.2, vZcWorld.y);
          float sky = clamp(vZcWorld.y / 45.0, 0.0, 1.0);
          vec3 glass = mix(GLASS_LOW, GLASS_HIGH, sky * 0.7 + 0.3 * zcHash(cell + vZcSeed));
          diffuseColor.rgb = mix(diffuseColor.rgb, glass, win * 0.85);
        } else if (vZcNormal.y > 0.5) {
          diffuseColor.rgb *= 0.93;
        }`,
      );
  };
  return mat;
}
