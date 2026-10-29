/**
 * Tissue materials with a small shader extension:
 *  - uHi / uHiColor: selection & hover highlight (colour blend + fresnel rim)
 *  - uCap: flat colour for back faces only while sectioning closed tooth solids
 */
import * as THREE from 'three';
import type { CategoryId } from '../anatomy/types';
import type { AppState } from '../state/store';

export interface TissueStyle {
  color: string;
  roughness: number;
  metalness?: number;
  clearcoat?: number;
  specularIntensity?: number;
  sheen?: number;
  /** cut-surface colour (defaults to a slightly darker base) */
  cap?: string;
  emissive?: string;
  /** fine surface grain (0…1): breaks up the plastic look of soft tissue; stretched along the fibre axis */
  grain?: number;
  /** low-contrast material variation in object space */
  mottle?: number;
  /** silhouette darkening (0…1): keeps overlapping soft structures apart */
  edge?: number;
}

const STYLES: Record<string, TissueStyle> = {
  'development-primary': { color: '#e8bd77', roughness: 0.42 },
  'development-unerupted': { color: '#70b4d0', roughness: 0.42 },
  'development-erupting': { color: '#a5c796', roughness: 0.42 },
  'development-permanent': { color: '#eee5d4', roughness: 0.42 },
  shell: { color: '#f1e6ce', roughness: 0.40, clearcoat: 0.025, specularIntensity: 0.48, cap: '#d8c79c', mottle: 0.018, edge: 0.025 },
  enamel: { color: '#f1e8d5', roughness: 0.38, clearcoat: 0.025, specularIntensity: 0.48, cap: '#eae4d5', mottle: 0.015, edge: 0.025 },
  'dentin-coronal': { color: '#e3c285', roughness: 0.6, cap: '#d9b56f' },
  'dentin-radicular': { color: '#dcb978', roughness: 0.62, cap: '#d1ab63' },
  cementum: { color: '#c7a071', roughness: 0.75, cap: '#b58f61' },
  'pulp-chamber': { color: '#c9454d', roughness: 0.5, cap: '#b3343d', emissive: '#3a0c0f' },
  canal: { color: '#b83842', roughness: 0.5, cap: '#a42d36', emissive: '#300a0d' },
  pdl: { color: '#d4847d', roughness: 0.6, cap: '#c26f68' },
  gingiva: { color: '#c77c81', roughness: 0.64, sheen: 0.32, specularIntensity: 0.65, cap: '#ac666c', mottle: 0.25, edge: 0.08 },
  bone: { color: '#e8e0cc', roughness: 0.82, cap: '#ddd0b2' },
  alveolar: { color: '#e4dac2', roughness: 0.85, cap: '#dacdb0' },
  condyle: { color: '#e4dac3', roughness: 0.75, cap: '#d0c2a1' },
  disc: { color: '#d3c5be', roughness: 0.6, sheen: 0.22, specularIntensity: 0.55, cap: '#b7a79f', grain: 0.12, mottle: 0.08, edge: 0.12 },
  skull: { color: '#e6dfcd', roughness: 0.85, cap: '#d6caac' },
  // soft tissue: deeper, less saturated colours than before, matte with a little sheen, and edge
  // definition instead of self-glow. Muscles get a faint fibre grain; nerve and vessel paths stay
  // smooth. Nerves, arteries and veins use the anatomy-atlas convention: yellow, red, blue.
  muscle: { color: '#a34d44', roughness: 0.62, sheen: 0.35, cap: '#8a3b33', grain: 0.3, edge: 0.28 },
  nerve: { color: '#d9b347', roughness: 0.48, sheen: 0.25, cap: '#c19a33', edge: 0.2 },
  artery: { color: '#c3362c', roughness: 0.45, clearcoat: 0.12, cap: '#a52a21', edge: 0.2 },
  vein: { color: '#3163c4', roughness: 0.48, clearcoat: 0.12, cap: '#254f9f', edge: 0.2 },
  // an air space, not tissue: always translucent (see SINUS_OPACITY in Engine), a strong
  // silhouette so its outline reads through the bone, and a cool colour apart from bone and nerves
  sinus: { color: '#8ec3d6', roughness: 0.58, clearcoat: 0.025, specularIntensity: 0.45, cap: '#6fa9bf', edge: 0.45 },
  'sinus-maxillary': { color: '#429cac', roughness: 0.58, clearcoat: 0.025, specularIntensity: 0.45, cap: '#347b89', edge: 0.45 },
  'sinus-frontal': { color: '#5c91ca', roughness: 0.58, clearcoat: 0.025, specularIntensity: 0.45, cap: '#4876aa', edge: 0.45 },
  'sinus-sphenoidal': { color: '#9782c1', roughness: 0.58, clearcoat: 0.025, specularIntensity: 0.45, cap: '#76619e', edge: 0.45 },
};

export function styleKeyFor(meshKey: string, cats: CategoryId[]): string {
  if (meshKey.startsWith('development-tooth-')) return 'development-permanent';
  if (/^tooth-\d\d$/.test(meshKey)) return 'shell';
  const m = /^(enamel|dentin-coronal|dentin-radicular|cementum|pulp-chamber|pdl)-\d\d$/.exec(meshKey);
  if (m) return m[1];
  if (/^canal-/.test(meshKey)) return 'canal';
  if (meshKey.startsWith('gingiva')) return 'gingiva';
  if (meshKey.includes('alveolar-process')) return 'alveolar';
  if (meshKey.includes('condyle')) return 'condyle';
  if (meshKey.startsWith('articular-disc')) return 'disc';
  if (cats.includes('sinus')) {
    const group = /^(maxillary|frontal|sphenoidal)-sinus/.exec(meshKey)?.[1];
    return group ? `sinus-${group}` : 'sinus';
  }
  if (cats.includes('nerves')) return 'nerve';
  if (cats.includes('arteries')) return 'artery';
  if (cats.includes('veins')) return 'vein';
  if (cats.includes('muscles')) return 'muscle';
  if (cats.includes('skull')) return 'skull';
  return 'bone';
}

export function styleFor(key: string): TissueStyle {
  return STYLES[key] ?? STYLES.bone;
}

export type SceneTheme = AppState['theme'];

/**
 * Renderer settings per UI theme. On the pale light-theme stage, ivory teeth and
 * bone wash out together; slightly lower exposure brings back surface shading.
 */
export const THEME_LIGHTING: Record<SceneTheme, { exposure: number; environment: number }> = {
  light: { exposure: 0.98, environment: 0.45 },
  dark: { exposure: 1, environment: 0.45 },
};

/** Light theme only: shade bone a touch so the teeth read against the jaws. */
const LIGHT_THEME_SHADE: Record<string, number> = { bone: 0.91, alveolar: 0.91, condyle: 0.91, skull: 0.93 };

export function themedColor(styleKey: string, theme: SceneTheme, which: 'color' | 'cap' = 'color'): THREE.Color {
  const st = styleFor(styleKey);
  const c = new THREE.Color(which === 'cap' ? (st.cap ?? st.color) : st.color);
  return theme === 'light' ? c.multiplyScalar(LIGHT_THEME_SHADE[styleKey] ?? 1) : c;
}

export interface FxUniforms {
  uHi: { value: number };
  uHiColor: { value: THREE.Color };
  uCap: { value: THREE.Color };
  uCapEnabled: { value: number };
  uRootCut: { value: number };
  uCervical: { value: THREE.Vector3 };
  uToothAxis: { value: THREE.Vector3 };
  uOpacityFx: { value: number };
  uGrain: { value: number };
  uMottle: { value: number };
  uEdge: { value: number };
  /** object-space fibre direction for the grain (set per mesh by the engine) */
  uFibre: { value: THREE.Vector3 };
}

/**
 * Rough fibre direction of a muscle: the longest side of its bounding box. Only a visual cue
 * for the grain (the source meshes carry no fibre data), so the grain is kept faint and only
 * partly stretched along it.
 */
export function fibreAxis(box: THREE.Box3): THREE.Vector3 {
  const s = box.getSize(new THREE.Vector3());
  return s.x >= s.y && s.x >= s.z ? new THREE.Vector3(1, 0, 0) : s.y >= s.z ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
}

export type TissueMaterial = THREE.MeshPhysicalMaterial & { userData: { fx: FxUniforms; styleKey: string } };

/** Selection and hover tint: the UI's single ultramarine accent. */
export const HIGHLIGHT = new THREE.Color('#3346f0');
export const HOVER = new THREE.Color('#8f9bff');
/** On blue tissue (veins) the accent would only read as "more blue": lighten toward white instead. */
export const HIGHLIGHT_ON_BLUE = new THREE.Color('#dfe4ff');
export const HOVER_ON_BLUE = new THREE.Color('#b9c3ff');

/** Selection and hover tint for a material. */
export function highlightColor(mat: TissueMaterial, hover: boolean): THREE.Color {
  if (mat.userData.styleKey === 'artery') return new THREE.Color(hover ? '#e97966' : '#ffb79c');
  const blue = mat.userData.styleKey === 'vein' || mat.userData.styleKey.startsWith('sinus');
  return hover ? (blue ? HOVER_ON_BLUE : HOVER) : blue ? HIGHLIGHT_ON_BLUE : HIGHLIGHT;
}

export function createTissueMaterial(styleKey: string): TissueMaterial {
  const st = styleFor(styleKey);
  const mat = new THREE.MeshPhysicalMaterial({
    color: st.color,
    vertexColors: styleKey === 'shell' || styleKey === 'enamel' || styleKey.startsWith('development-'),
    roughness: st.roughness,
    metalness: st.metalness ?? 0,
    clearcoat: st.clearcoat ?? 0,
    clearcoatRoughness: 0.35,
    specularIntensity: st.specularIntensity ?? 1,
    sheen: st.sheen ?? 0,
    sheenColor: new THREE.Color(st.color).multiplyScalar(1.1),
    emissive: st.emissive ?? '#000000',
    side: THREE.DoubleSide,
  }) as TissueMaterial;
  const fx: FxUniforms = {
    uHi: { value: 0 },
    uHiColor: { value: HIGHLIGHT.clone() },
    uCap: { value: new THREE.Color(st.cap ?? st.color) },
    uCapEnabled: { value: 0 },
    uRootCut: { value: -100 },
    uCervical: { value: new THREE.Vector3() },
    uToothAxis: { value: new THREE.Vector3(0, 1, 0) },
    uOpacityFx: { value: 1 },
    uGrain: { value: st.grain ?? 0 },
    uMottle: { value: st.mottle ?? 0 },
    uEdge: { value: st.edge ?? 0 },
    uFibre: { value: new THREE.Vector3(0, 1, 0) },
  };
  mat.userData = { fx, styleKey };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, fx);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vDsPos;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vDsPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform float uHi;\nuniform vec3 uHiColor;\nuniform vec3 uCap;\nuniform float uCapEnabled;\nuniform float uRootCut;\nuniform vec3 uCervical;\nuniform vec3 uToothAxis;\nuniform float uOpacityFx;\nuniform float uGrain;\nuniform float uMottle;\nuniform float uEdge;\nuniform vec3 uFibre;\nvarying vec3 vDsPos;
float dsHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float dsNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dsHash(i), dsHash(i + vec3(1,0,0)), f.x), mix(dsHash(i + vec3(0,1,0)), dsHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(dsHash(i + vec3(0,0,1)), dsHash(i + vec3(1,0,1)), f.x), mix(dsHash(i + vec3(0,1,1)), dsHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
void main() {
  if (dot(vDsPos - uCervical, uToothAxis) < uRootCut) discard;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (uGrain > 0.0) {
          // fine, low-contrast grain (2 octaves), partly stretched along the fibre axis;
          // 16 cycles per cm (app units are cm) ≈ fibre-bundle scale at normal zoom
          vec3 q = (vDsPos - uFibre * dot(vDsPos, uFibre) * 0.6) * 16.0;
          float n = dsNoise(q) * 0.65 + dsNoise(q * 2.7) * 0.35;
          diffuseColor.rgb *= 1.0 + uGrain * (n - 0.5);
        }
        if (uMottle > 0.0) {
          float broad = dsNoise(vDsPos * 8.0);
          float fine = dsNoise(vDsPos * 58.0);
          diffuseColor.rgb *= 1.0 + uMottle * (0.72 * (broad - 0.5) + 0.28 * (fine - 0.5));
        }`,
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        {
          vec3 vdir = normalize(vViewPosition);
          float fres = pow(1.0 - clamp(abs(dot(normalize(vNormal), vdir)), 0.0, 1.0), 2.2);
          vec3 hi = linearToOutputTexel(vec4(uHiColor, 1.0)).rgb;
          gl_FragColor.rgb *= 1.0 - uEdge * fres;
          gl_FragColor.rgb = mix(gl_FragColor.rgb, hi, uHi * (0.16 + 0.7 * fres));
          if (uCapEnabled > 0.5 && !gl_FrontFacing) {
            // cut surface: flat tissue colour (converted to output space), lightly shaded by depth
            vec3 cap = linearToOutputTexel(vec4(uCap, 1.0)).rgb;
            cap = mix(cap, hi, uHi * 0.35);
            gl_FragColor = vec4(cap, gl_FragColor.a);
          }
          gl_FragColor.a *= uOpacityFx;
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'ds-tissue';
  return mat;
}

/** Point a grained material's grain along the mesh's rough fibre direction. */
export function setFibreAxis(mat: TissueMaterial, geometryBounds: THREE.Box3) {
  if (mat.userData.fx.uGrain.value > 0) mat.userData.fx.uFibre.value.copy(fibreAxis(geometryBounds));
}

/** Surface and cut-surface colours for the given theme. */
export function applyThemeToMaterial(mat: TissueMaterial, theme: SceneTheme) {
  const key = mat.userData.styleKey;
  mat.color.copy(themedColor(key, theme));
  mat.userData.fx.uCap.value.copy(themedColor(key, theme, 'cap'));
}

/** Apply opacity with sensible transparency settings. */
export function setMaterialOpacity(mat: TissueMaterial, opacity: number) {
  const transparent = opacity < 0.999;
  if (mat.transparent !== transparent) {
    mat.transparent = transparent;
    mat.depthWrite = !transparent;
    // ghosts are single-sided so they don't show cut caps / inner faces
    mat.side = transparent ? THREE.FrontSide : THREE.DoubleSide;
    mat.needsUpdate = true;
  }
  mat.opacity = opacity;
}
