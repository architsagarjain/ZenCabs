import * as THREE from 'three';

export const sharedMaterials = {
  carBody: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.35 }),
  carLights: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
};

/** Building material with procedural lit windows computed in world space. */
export function createBuildingMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, metalness: 0.1 });
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
        float zcHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        if (abs(vZcNormal.y) < 0.5) {
          float h = abs(vZcNormal.x) > 0.5 ? vZcWorld.z : vZcWorld.x;
          vec2 cell = vec2(floor(h / 3.4), floor((vZcWorld.y - 1.2) / 3.6));
          vec2 f = vec2(fract(h / 3.4), fract((vZcWorld.y - 1.2) / 3.6));
          float win = step(0.2, f.x) * step(f.x, 0.8) * step(0.28, f.y) * step(f.y, 0.78) * step(1.2, vZcWorld.y);
          float rnd = zcHash(cell + vec2(vZcSeed * 7.13, vZcSeed * 1.7));
          float lit = step(0.8, rnd);
          vec3 tint = mix(vec3(1.0, 0.74, 0.42), vec3(0.62, 0.82, 1.0), step(0.86, zcHash(cell.yx + vZcSeed)));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06, 0.09, 0.14), win * 0.8);
          totalEmissiveRadiance += win * lit * tint * (0.35 + 0.45 * zcHash(cell * 3.1));
        } else if (vZcNormal.y > 0.5) {
          diffuseColor.rgb *= 1.25;
        }`,
      );
  };
  return mat;
}
