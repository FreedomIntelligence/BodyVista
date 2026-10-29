/**
 * Exploded views. Offsets are pure functions of the mesh key + registry data;
 * the engine interpolates them by the explode scalar.
 *
 * Arch level ("Dissect anatomy", in position): the skull and maxillae move up and the
 * mandible down, then each jaw separates in clean tiers toward the bite — bone, gingiva,
 * teeth — with each tooth slid out of its socket along its own axis, clear of the gum. The tier
 * distances come from the asset build (manifest.explode), measured so that no tier passes
 * through another. Nerves and vessels stay in their true position relative to the bone:
 * they sit at the mandible's offset and stretch toward the skull's offset by a per-vertex
 * jaw weight (see `neurovascularStretch`), so the connections between the jaws stay intact.
 * Tooth level: layers separate along the tooth's own axes.
 */
import * as THREE from 'three';
import type { Registry } from '../anatomy/registry';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function toothVec(registry: Registry, fdi: number, key: 'axis' | 'buccal' | 'mesial'): THREE.Vector3 {
  const f = registry.get(`tooth-${fdi}`)?.tooth?.frame;
  return f ? V(...f[key]) : V(0, fdi < 30 ? -1 : 1, 0);
}

/** Tier distances; used when an older manifest has no measured plan. */
const FALLBACK_PLAN = { jaw: 4.6, upper: { gingiva: 1.6, teeth: 3.8 }, lower: { gingiva: 2.4, teeth: 4.7 } };

export function archPlan(registry: Registry) {
  return registry.manifest.explode ?? FALLBACK_PLAN;
}

export function isNeurovascular(cats: readonly string[]): boolean {
  return cats.includes('nerves') || cats.includes('arteries') || cats.includes('veins');
}

/**
 * Per-vertex stretch of a nerve or vessel at explode = 1, scaled by its jaw weight
 * (0 = moves with the mandible, 1 = moves with the skull and maxillae).
 */
export function neurovascularStretch(registry: Registry): THREE.Vector3 {
  return V(0, 2 * archPlan(registry).jaw, 0);
}

/** Arch-level offset at explode = 1 (app units, cm). `center` = mesh bounds centre. */
export function archOffset(registry: Registry, meshKey: string, center: THREE.Vector3): THREE.Vector3 {
  const owner = registry.get(registry.meshOwner.get(meshKey) ?? '');
  const cats = registry.categoriesOfMesh(meshKey);
  const side = Math.sign(center.x) || 1;
  const fdi = owner?.toothFdi;
  const plan = archPlan(registry);

  const upper = V(0, plan.jaw, 0);
  const lower = V(0, -plan.jaw, 0);
  const upperGum = upper.clone().add(V(0, -plan.upper.gingiva, 0));
  const lowerGum = lower.clone().add(V(0, plan.lower.gingiva, 0));

  // Every part of a tooth (shell and internal layers) moves with the tooth: with its gum,
  // then out of the socket along its own long axis (a tilted root pulled straight would cut
  // through the socket wall), just far enough to clear the gum.
  if (fdi !== undefined) {
    const extract = registry.manifest.teeth[String(fdi)]?.extract ?? (fdi < 30 ? plan.upper.teeth - plan.upper.gingiva : plan.lower.teeth - plan.lower.gingiva);
    return (fdi < 30 ? upperGum : lowerGum).clone().addScaledVector(toothVec(registry, fdi, 'axis'), extract);
  }
  if (meshKey === 'gingiva-upper') return upperGum;
  if (meshKey === 'gingiva-lower') return lowerGum;
  if (meshKey.startsWith('maxilla-') || meshKey.startsWith('maxillary-alveolar-process') || meshKey.startsWith('maxillary-sinus') || meshKey.startsWith('palatine')) return upper.clone();
  if (meshKey.startsWith('mandible') || meshKey.startsWith('mandibular')) return lower.clone();
  // the disc stays in its fossa on the temporal bone
  if (meshKey.startsWith('articular-disc') || meshKey.startsWith('articular-fossa')) return upper.clone();

  // nerves and vessels: mandible offset here; the engine adds the per-vertex stretch
  if (isNeurovascular(cats)) return lower.clone();

  // The lip ring sits in front of the teeth and spans the midline, so a sideways push leaves it over the
  // incisors. Move it forward and just below the lower crowns instead (in front of the chin).
  if (meshKey === 'orbicularis-oris') return lipRingOffset(registry, lower);
  if (cats.includes('muscles')) return (center.y > 1.5 ? upper : lower).clone().add(V(side * 3.2, 0, center.z > 2.5 ? 2 : 0));
  // the hyoid hangs below the mandible and goes down with it; the rest of the skull goes up with the maxillae
  if (cats.includes('skull')) return center.y < -2 ? lower.clone() : upper.clone();
  return V();
}

/**
 * The lip ring goes forward and down to sit just below the separated lower crowns, so it
 * never covers a crown when seen from the front.
 */
function lipRingOffset(registry: Registry, lower: THREE.Vector3): THREE.Vector3 {
  const meshes = registry.manifest.meshes;
  const lips = meshes['orbicularis-oris'];
  if (!lips) return lower.clone().add(V(0, 0, 2.6));
  let crownMin = Infinity;
  for (const [key, m] of Object.entries(meshes)) {
    const fdi = /^enamel-(\d\d)$/.exec(key)?.[1];
    if (!fdi || Number(fdi) < 30) continue;
    const c = new THREE.Vector3(...m.bounds[0]).add(new THREE.Vector3(...m.bounds[1])).multiplyScalar(0.5);
    crownMin = Math.min(crownMin, m.bounds[0][1] + archOffset(registry, key, c).y);
  }
  if (!Number.isFinite(crownMin)) return lower.clone().add(V(0, 0, 2.6));
  return V(0, crownMin - 0.15 - lips.bounds[1][1], 2.6);
}

/** Tooth-level offset at toothExplode = 1 for one layer mesh. */
export function toothLayerOffset(registry: Registry, meshKey: string): THREE.Vector3 {
  const fdi = registry.get(registry.meshOwner.get(meshKey) ?? '')?.toothFdi;
  if (fdi === undefined) return V();
  const axis = toothVec(registry, fdi, 'axis');
  const mesial = toothVec(registry, fdi, 'mesial');
  const kind = meshKey.replace(/-\d{2}$/, '');
  if (kind === 'enamel') return axis.clone().multiplyScalar(1.05);
  if (kind === 'dentin-coronal') return axis.clone().multiplyScalar(0.38);
  if (kind === 'dentin-radicular') return V();
  if (kind === 'cementum') return axis.clone().multiplyScalar(-0.55);
  if (kind === 'pdl') return axis.clone().multiplyScalar(-1.1);
  if (kind === 'pulp-chamber' || kind.startsWith('canal-')) return mesial.clone().multiplyScalar(-1.25).addScaledVector(axis, 0.12);
  return V();
}

/**
 * Tooth-level offset at toothExplode = 1 on the Root canals level, where only the pulp is shown:
 * the pulp chamber lifts toward the crown, the canals drop toward the apex and fan out by root
 * (mesial/distal, buccal/palatal-lingual), so the chamber–canal boundary and each canal read on their own.
 */
export function pulpLayerOffset(registry: Registry, meshKey: string): THREE.Vector3 {
  const fdi = registry.get(registry.meshOwner.get(meshKey) ?? '')?.toothFdi;
  if (fdi === undefined) return V();
  const axis = toothVec(registry, fdi, 'axis');
  const kind = meshKey.replace(/-\d{2}$/, '');
  if (kind === 'pulp-chamber') return axis.clone().multiplyScalar(0.9);
  if (!kind.startsWith('canal-')) return V();
  const mesial = toothVec(registry, fdi, 'mesial');
  const buccal = toothVec(registry, fdi, 'buccal');
  const out = axis.clone().multiplyScalar(-0.35);
  const name = kind.slice('canal-'.length);
  if (name.includes('mesio') || name.startsWith('mesial')) out.addScaledVector(mesial, 0.5);
  if (name.includes('disto') || name.startsWith('distal')) out.addScaledVector(mesial, -0.5);
  if (name.includes('buccal')) out.addScaledVector(buccal, 0.5);
  if (name.includes('palatal') || name.includes('lingual')) out.addScaledVector(buccal, -0.5);
  // second canal in the same root (e.g. mesial-1 / mesial-2): nudge apart along the buccal direction
  if (/-1$/.test(name)) out.addScaledVector(buccal, 0.3);
  if (/-2$/.test(name)) out.addScaledVector(buccal, -0.3);
  return out;
}
