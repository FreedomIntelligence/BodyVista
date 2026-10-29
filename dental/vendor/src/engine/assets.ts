/**
 * Staged asset loading (docs/architecture.md §7).
 * GLB files contain one node per mesh key; geometry is already in app space.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { Manifest } from '../anatomy/types';

const BASE = `${import.meta.env.BASE_URL}models/`;

export async function loadManifest(): Promise<Manifest> {
  const res = await fetch(`${BASE}manifest.json`);
  if (!res.ok) throw new Error(`Could not load anatomy manifest (${res.status})`);
  return (await res.json()) as Manifest;
}

/** Convert quantized/interleaved attributes to plain Float32 so transforms can be baked. */
export function toFloatGeometry(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  for (const name of ['position', 'normal'] as const) {
    const a = src.getAttribute(name) as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
    if (!a) continue;
    const arr = new Float32Array(a.count * 3);
    for (let i = 0; i < a.count; i++) {
      arr[i * 3] = a.getX(i);
      arr[i * 3 + 1] = a.getY(i);
      arr[i * 3 + 2] = a.getZ(i);
    }
    geo.setAttribute(name, new THREE.BufferAttribute(arr, 3));
  }
  // neurovascular meshes carry a per-vertex jaw weight in their colour (see explode.ts)
  const jaw = src.getAttribute('color') as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
  if (jaw) {
    const w = new Float32Array(jaw.count);
    for (let i = 0; i < jaw.count; i++) w[i] = jaw.getX(i);
    geo.setAttribute('jaw', new THREE.BufferAttribute(w, 1));
  }
  // GLTF primitives can share an index buffer. BVH construction reorders it,
  // so each loaded mesh must own its indices to keep earlier BVHs valid.
  if (src.index) geo.setIndex(src.index.clone());
  return geo;
}

export class AssetLoader {
  private loader = new GLTFLoader();
  private inflight = new Map<string, Promise<Map<string, THREE.BufferGeometry>>>();

  constructor() {
    this.loader.setMeshoptDecoder(MeshoptDecoder);
  }

  /** Load a GLB and return geometry by node name. Deduplicates concurrent requests. */
  load(file: string, onProgress?: (p: number) => void): Promise<Map<string, THREE.BufferGeometry>> {
    const existing = this.inflight.get(file);
    if (existing) return existing;
    const p = new Promise<Map<string, THREE.BufferGeometry>>((resolve, reject) => {
      this.loader.load(
        BASE + file,
        (gltf) => {
          const out = new Map<string, THREE.BufferGeometry>();
          gltf.scene.updateMatrixWorld(true);
          gltf.scene.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            const geo = toFloatGeometry(mesh.geometry);
            // bake node transform (meshopt quantization stores a dequantizing scale/offset on the node)
            if (!mesh.matrixWorld.equals(new THREE.Matrix4())) geo.applyMatrix4(mesh.matrixWorld);
            // node name may be the mesh or its parent
            const key = mesh.name && !mesh.name.startsWith('mesh_') ? mesh.name : mesh.parent?.name || mesh.name;
            if (!geo.getAttribute('normal')) geo.computeVertexNormals();
            geo.computeBoundingBox();
            geo.computeBoundingSphere();
            out.set(key, geo);
          });
          onProgress?.(1);
          resolve(out);
        },
        (ev) => {
          if (ev.total) onProgress?.(Math.min(0.99, ev.loaded / ev.total));
        },
        (err) => {
          this.inflight.delete(file);
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      );
    });
    this.inflight.set(file, p);
    return p;
  }
}
